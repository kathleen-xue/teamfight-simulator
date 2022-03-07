import { state, gameOver } from '#/game/store'
import { updatePaths } from '#/game/pathfind'

const GAME_TICK_MS = 1000 / 30

let frameID: number | null = null
let startedAtMS: DOMHighResTimeStamp = 0
let previousFrameMS: DOMHighResTimeStamp = 0

const MOVE_LOCKOUT_JUMPERS_MS = 500
const MOVE_LOCKOUT_MELEE_MS = 1000

let didBacklineJump = false

function updateHexEffects(elapsedMS: DOMHighResTimeStamp) {
	state.hexEffects.forEach(hexEffect => {
		if (hexEffect.activated && elapsedMS > hexEffect.expiresAtMS) {
			state.hexEffects.delete(hexEffect)
			return
		}
		if (elapsedMS < hexEffect.activatesAtMS) {
			return
		}
		hexEffect.activated = true
		const affectingUnits = hexEffect.targetTeam === 2 ? state.units : state.units.filter(unit => unit.team === hexEffect.targetTeam)
		for (const unit of affectingUnits.filter(unit => unit.isIn(hexEffect.hexes))) {
			if (hexEffect.damage != null) {
				unit.damage(elapsedMS, hexEffect.damage, hexEffect.damageType!, hexEffect.source, state.units, gameOver)
			}
			if (hexEffect.stunMS != null) {
				unit.stunnedUntilMS = Math.max(unit.stunnedUntilMS, elapsedMS + hexEffect.stunMS)
			}
			hexEffect.onCollision?.(unit)
		}
	})
}

function requestNextFrame(frameMS: DOMHighResTimeStamp, unanimated?: boolean) {
	if (unanimated === true) {
		runLoop(frameMS + GAME_TICK_MS, true)
	} else {
		frameID = window.requestAnimationFrame(runLoop)
	}
}
export function runLoop(frameMS: DOMHighResTimeStamp, unanimated?: boolean) {
	const diffMS = frameMS - previousFrameMS
	if (diffMS < GAME_TICK_MS - 1) {
		requestNextFrame(frameMS, unanimated)
		return
	}
	const isFirstLoop = !startedAtMS
	if (isFirstLoop) {
		previousFrameMS = frameMS
		startedAtMS = frameMS
		updatePaths(state.units)
		didBacklineJump = false
	}
	const elapsedMS = frameMS - startedAtMS
	if (elapsedMS >= MOVE_LOCKOUT_JUMPERS_MS) {
		didBacklineJump = true
	}

	for (const unit of state.units) {
		if (unit.dead || unit.isMoving(elapsedMS) || unit.range() <= 0 || unit.stunnedUntilMS > elapsedMS) {
			continue
		}
		unit.updateRegen(elapsedMS)
		unit.updateShields(elapsedMS)

		if (unit.banishUntilMS != null && unit.banishUntilMS <= elapsedMS) {
			unit.banishUntil(null)
		}
		if (!unit.interacts) {
			continue
		}

		for (const pendingHexEffect of unit.pending.hexEffects) {
			if (elapsedMS >= pendingHexEffect.startsAtMS) {
				state.hexEffects.add(pendingHexEffect)
				unit.pending.hexEffects.delete(pendingHexEffect)
			}
		}
		for (const pendingProjectile of unit.pending.projectiles) {
			if (elapsedMS >= pendingProjectile.startsAtMS) {
				state.projectiles.add(pendingProjectile)
				unit.pending.projectiles.delete(pendingProjectile)
			}
		}
		if (unit.readyToCast()) {
			unit.castAbility(elapsedMS)
		}
		if (didBacklineJump) {
			unit.updateTarget(state.units)
		}
		if (unit.target) {
			unit.updateAttack(elapsedMS, state.units, gameOver)
		} else {
			if (elapsedMS < MOVE_LOCKOUT_MELEE_MS) {
				if (!didBacklineJump) {
					if (!unit.jumpsToBackline()) {
						continue
					}
					unit.jumpToBackline(elapsedMS, state.units)
					continue
				} else if (unit.range() > 1) {
					continue
				}
			}
			unit.updateMove(elapsedMS, state.units)
		}
	}
	updateHexEffects(elapsedMS)

	for (const projectile of state.projectiles) {
		if (!projectile.update(elapsedMS, diffMS, state.units, gameOver)) {
			state.projectiles.delete(projectile)
		}
	}
	if (isFirstLoop) {
		updatePaths(state.units)
	}

	previousFrameMS = frameMS
	requestNextFrame(frameMS, unanimated)
}

export function cancelLoop() {
	startedAtMS = 0
	if (frameID !== null) {
		window.cancelAnimationFrame(frameID)
		frameID = null
	}
}
