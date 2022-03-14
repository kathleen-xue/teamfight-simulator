import { markRaw } from 'vue'

import { BonusKey, DamageType } from '@tacticians-academy/academy-library'
import type { ChampionData, ChampionSpellData, EffectVariables, ItemData, SpellCalculation, TraitData } from '@tacticians-academy/academy-library'

import { champions } from '@tacticians-academy/academy-library/dist/set6/champions'
import { ItemKey } from '@tacticians-academy/academy-library/dist/set6/items'
import { TraitKey, traits } from '@tacticians-academy/academy-library/dist/set6/traits'

import itemEffects from '#/data/items'
import championEffects from '#/data/set6/champions'
import traitEffects from '#/data/set6/traits'

import { getNextHex, needsPathfindingUpdate } from '#/game/pathfind'
import { Projectile } from '#/game/Projectile'
import type { ProjectileData } from '#/game/Projectile'
import { HexEffect } from '#/game/HexEffect'
import type { HexEffectData } from '#/game/HexEffect'
import { coordinatePosition, gameOver, state, thresholdCheck } from '#/game/store'

import { containsHex, getClosestHexAvailableTo, getNearestAttackableEnemies, getSurroundingWithin, hexDistanceFrom, isSameHex } from '#/helpers/boardUtils'
import { calculateItemBonuses, calculateSynergyBonuses, createDamageCalculation, solveSpellCalculationFor } from '#/helpers/bonuses'
import { BACKLINE_JUMP_MS, BOARD_ROW_COUNT, BOARD_ROW_PER_SIDE_COUNT, DEFAULT_MANA_LOCK_MS, HEX_PROPORTION_PER_LEAGUEUNIT, LOCKED_STAR_LEVEL_BY_UNIT_API_NAME } from '#/helpers/constants'
import { saveUnits } from '#/helpers/storage'
import { MutantType, MutantBonus, SpellKey, DamageSourceType, StatusEffectType } from '#/helpers/types'
import type { BleedData, BonusLabelKey, BonusScaling, BonusVariable, ChampionFns, HexCoord, StarLevel, StatusEffect, TeamNumber, ShieldData, SynergyData } from '#/helpers/types'
import { randomItem, uniqueIdentifier } from '#/helpers/utils'

let instanceIndex = 0

export class ChampionUnit {
	instanceID: string
	name: string
	startHex: HexCoord
	team: TeamNumber = 0
	starLevel: StarLevel
	data: ChampionData

	activeHex: HexCoord
	dead = false
	target: ChampionUnit | null = null // eslint-disable-line no-use-before-define
	mana = 0
	health = 0
	healthMax = 0
	starMultiplier = 1
	isStarLocked: boolean
	fixedAS: number | undefined = undefined
	instantAttack: boolean

	statusEffects = {} as Record<StatusEffectType, StatusEffect>

	collides = true
	interacts = true

	banishUntilMS: DOMHighResTimeStamp | null = null
	cachedTargetDistance = 0
	attackStartAtMS: DOMHighResTimeStamp = 0
	moveUntilMS: DOMHighResTimeStamp = 0
	manaLockUntilMS: DOMHighResTimeStamp = 0
	stunnedUntilMS: DOMHighResTimeStamp = 0
	items: ItemData[] = []
	traits: TraitData[] = []
	activeSynergies: SynergyData[] = []
	transformIndex = 0

	nextAttack: SpellCalculation | undefined //TODO
	championEffects: ChampionFns | undefined

	bonuses: [BonusLabelKey, BonusVariable[]][] = []
	scalings = new Set<BonusScaling>()
	shields: ShieldData[] = []
	bleeds = new Set<BleedData>()

	pending = {
		bonuses: new Set<[DOMHighResTimeStamp, BonusLabelKey, BonusVariable[]]>(),
		hexEffects: new Set<HexEffect>(),
		projectiles: new Set<Projectile>(),
	}

	constructor(name: string, hex: HexCoord, starLevel: StarLevel) {
		this.instanceID = `c${instanceIndex += 1}`
		const stats = champions.find(unit => unit.name === name) ?? champions[0]
		const starLockedLevel = LOCKED_STAR_LEVEL_BY_UNIT_API_NAME[stats.apiName]
		this.isStarLocked = !!starLockedLevel
		this.data = markRaw(stats)
		this.name = name
		this.starLevel = starLockedLevel ?? starLevel
		this.championEffects = championEffects[name]
		this.instantAttack = this.data.stats.range <= 1
		this.startHex = hex
		this.activeHex = hex
		this.reposition(hex)

		for (const effectType in StatusEffectType) {
			this.statusEffects[effectType as StatusEffectType] = {
				active: false,
				expiresAt: 0,
				amount: 0,
			}
		}
	}

	reset(synergiesByTeam: SynergyData[][]) {
		Object.keys(this.pending).forEach(key => (this.pending as Record<string, Set<any>>)[key].clear())
		this.bleeds.clear()

		for (const effectType in this.statusEffects) {
			const statusEffect = this.statusEffects[effectType as StatusEffectType]
			statusEffect.active = false
			statusEffect.amount = 0
			statusEffect.expiresAt = 0
		}

		this.starMultiplier = Math.pow(1.8, this.starLevel - 1)
		this.dead = false
		this.target = null
		this.activeHex = this.startHex
		this.cachedTargetDistance = 0
		this.attackStartAtMS = 0
		this.moveUntilMS = 0
		this.manaLockUntilMS = 0
		this.stunnedUntilMS = 0
		const jumpToBackline = this.jumpsToBackline()
		this.collides = !jumpToBackline
		this.interacts = true
		this.banishUntilMS = 0
		if (this.hasTrait(TraitKey.Transformer)) {
			const col = this.activeHex[1]
			this.transformIndex = col >= 2 && col < BOARD_ROW_COUNT - 2 ? 0 : 1
		} else {
			this.transformIndex = 0
		}

		const unitTraitKeys = (this.data.traits as TraitKey[]).concat(this.items.filter(item => item.name.endsWith(' Emblem')).map(item => item.name.replace(' Emblem', '') as TraitKey))
		this.traits = Array.from(new Set(unitTraitKeys)).map(traitKey => traits.find(trait => trait.name === traitKey)).filter((trait): trait is TraitData => trait != null)
		const teamSynergies = synergiesByTeam[this.team]
		this.activeSynergies = teamSynergies.filter(([trait, style, activeEffect]) => !!activeEffect)
		const [synergyTraitBonuses, synergyScalings, synergyShields] = calculateSynergyBonuses(this, teamSynergies, unitTraitKeys)
		const [itemBonuses, itemScalings, itemShields] = calculateItemBonuses(this, this.items)
		this.bonuses = [...synergyTraitBonuses, ...itemBonuses]
		this.scalings = new Set([...synergyScalings, ...itemScalings])
		this.shields = [...synergyShields, ...itemShields]

		this.setMana(this.data.stats.initialMana + this.getBonuses(BonusKey.Mana))
		this.health = this.data.stats.hp * this.starMultiplier + this.getBonusVariants(BonusKey.Health)
		this.healthMax = this.health
		this.fixedAS = this.getSpellVariable(SpellKey.AttackSpeed) //TODO Jhin set data
	}

	addBonuses(key: BonusLabelKey, ...bonuses: BonusVariable[]) {
		this.bonuses.push([key, bonuses])
	}

	updateTarget() {
		if (this.target != null) {
			const targetDistance = this.hexDistanceTo(this.target)
			if (!this.target.isAttackable() || targetDistance > this.range()) {
				this.target = null
			} else {
				this.cachedTargetDistance = targetDistance
			}
		}
		if (this.target == null) {
			const targets = getNearestAttackableEnemies(this, state.units)
			if (targets.length) {
				this.target = randomItem(targets)! //TODO random
				this.cachedTargetDistance = this.hexDistanceTo(this.target)
				// console.log(this.name, this.team, 'targets at', this.cachedTargetDistance, 'hexes', this.target.name, this.target.team)
			}
		}
	}

	updateAttack(elapsedMS: DOMHighResTimeStamp) {
		if (this.target == null) {
			return
		}
		let attackSpeed = this.attackSpeed()
		const attackSpeedSlow = this.getStatusEffect(elapsedMS, StatusEffectType.attackSpeedSlow)
		if (attackSpeedSlow != null) {
			attackSpeed *= 1 - attackSpeedSlow / 100
		}
		const msBetweenAttacks = 1000 / attackSpeed
		if (elapsedMS < this.attackStartAtMS + msBetweenAttacks) {
			return
		}
		if (this.attackStartAtMS <= 0) {
			this.attackStartAtMS = elapsedMS
		} else {
			const canReProcAttack = this.attackStartAtMS > 1
			const damageCalculation = createDamageCalculation(BonusKey.AttackDamage, 1, undefined, BonusKey.AttackDamage, 1)
			const passiveFn = this.championEffects?.passive
			if (this.instantAttack) {
				this.target.damage(elapsedMS, true, this, DamageSourceType.attack, damageCalculation, false)
				this.attackStartAtMS = elapsedMS
				passiveFn?.(elapsedMS, this.target, this)
			} else {
				const source = this
				this.queueProjectile(elapsedMS, undefined, {
					startsAfterMS: msBetweenAttacks / 4, //TODO from data
					missile: {
						speedInitial: this.data.basicAttackMissileSpeed ?? this.data.critAttackMissileSpeed ?? 1000, //TODO crits
					},
					sourceType: DamageSourceType.attack,
					target: this.target,
					damageCalculation,
					onCollision(elapsedMS, unit) {
						passiveFn?.(elapsedMS, unit, source)
					},
				})
			}
			this.gainMana(elapsedMS, 10 + this.getBonuses(BonusKey.ManaRestorePerAttack))

			this.items.forEach((item, index) => itemEffects[item.id as ItemKey]?.basicAttack?.(elapsedMS, item, uniqueIdentifier(index, item), this.target!, this, canReProcAttack))
			this.activeSynergies.forEach(([trait, style, activeEffect]) => traitEffects[trait.name as TraitKey]?.basicAttack?.(activeEffect!, this.target!, this, canReProcAttack))
		}
	}

	updateBleeds(elapsedMS: DOMHighResTimeStamp) {
		this.bleeds.forEach(bleed => {
			if (elapsedMS >= bleed.activatesAtMS) {
				bleed.activatesAtMS += bleed.repeatsEveryMS
				bleed.remainingIterations -= 1
				this.damage(elapsedMS, false, bleed.source, DamageSourceType.item, bleed.damageCalculation, false)
				console.log(bleed)
				if (bleed.remainingIterations <= 0) {
					this.bleeds.delete(bleed)
				}
			}
		})
	}

	updateBonuses(elapsedMS: DOMHighResTimeStamp) {
		this.bonuses.forEach(bonus => bonus[1] = bonus[1].filter(variable => variable[2] == null || variable[2] > elapsedMS))
	}

	updateRegen(elapsedMS: DOMHighResTimeStamp) {
		this.scalings.forEach(scaling => {
			if (scaling.activatedAt === 0) {
				scaling.activatedAt = elapsedMS
				return
			}
			if (scaling.expiresAfter != null && scaling.activatedAt + scaling.expiresAfter >= elapsedMS) {
				this.scalings.delete(scaling)
				return
			}
			if (elapsedMS < scaling.activatedAt + scaling.intervalSeconds * 1000) {
				return
			}
			scaling.activatedAt = elapsedMS
			const bonuses: BonusVariable[] = []
			for (const stat of scaling.stats) {
				if (stat === BonusKey.Health) {
					//TODO
				} else if (stat === BonusKey.Mana) {
					this.addMana(scaling.intervalAmount)
				} else {
					bonuses.push([stat, scaling.intervalAmount])
				}
			}
			this.addBonuses(scaling.source as TraitKey, ...bonuses)
		})
	}

	updateShields(elapsedMS: DOMHighResTimeStamp) {
		this.shields.forEach(shield => {
			if (shield.expiresAtMS != null && elapsedMS >= shield.expiresAtMS) {
				shield.activated = false
				if (shield.repeatsEveryMS == null) {
					return
				}
			}

			if (shield.activated !== true) {
				if (shield.activatesAtMS != null) {
					if (elapsedMS >= shield.activatesAtMS) {
						shield.activated = true
						if (shield.repeatsEveryMS != null) {
							shield.activatesAtMS += shield.repeatsEveryMS
							if (shield.expiresAtMS != null) {
								shield.expiresAtMS += shield.repeatsEveryMS
							}
						}
						if (shield.repeatAmount != null) {
							shield.amount = shield.repeatAmount
						}
					}
				}
			}
		})
	}

	rawCritChance() {
		return (this.data.stats.critChance ?? 0) + this.getBonuses(BonusKey.CritChance) / 100
	}
	critChance() {
		return Math.min(1, this.rawCritChance())
	}
	critMultiplier() {
		const excessCritChance = this.rawCritChance() - 1
		return this.data.stats.critMultiplier + Math.max(0, excessCritChance) + this.getBonuses(BonusKey.CritMultiplier) / 100
	}
	critReduction() {
		return this.getBonuses(BonusKey.CritReduction) / 100
	}

	updateMove(elapsedMS: DOMHighResTimeStamp) {
		const nextHex = getNextHex(this)
		if (nextHex) {
			const msPerHex = 1000 * this.moveSpeed() * HEX_PROPORTION_PER_LEAGUEUNIT
			this.moveUntilMS = elapsedMS + msPerHex
			this.activeHex = nextHex
			needsPathfindingUpdate()
			return true
		}
		return false
	}

	getStatusEffect(elapsedMS: DOMHighResTimeStamp, effectType: StatusEffectType) {
		const statusEffect = this.statusEffects[effectType]
		if (statusEffect.active && elapsedMS < statusEffect.expiresAt) {
			return statusEffect.amount
		}
		return undefined
	}
	applyStatusEffect(elapsedMS: DOMHighResTimeStamp, effectType: StatusEffectType, durationMS: DOMHighResTimeStamp, amount: number = 1) {
		const expireAt = elapsedMS + durationMS
		const statusEffect = this.statusEffects[effectType]
		if (!statusEffect.active || expireAt > statusEffect.expiresAt) {
			statusEffect.active = true
			statusEffect.expiresAt = expireAt
			statusEffect.amount = amount
			if (effectType === StatusEffectType.stealth) {
				needsPathfindingUpdate()
			}
		}
	}

	updateStatusEffects(elapsedMS: DOMHighResTimeStamp) {
		for (const effectType in this.statusEffects) {
			const statusEffect = this.statusEffects[effectType as StatusEffectType]
			if (statusEffect.active && elapsedMS >= statusEffect.expiresAt) {
				statusEffect.active = false
			}
		}
	}

	opposingTeam(): TeamNumber {
		return 1 - this.team as TeamNumber
	}

	readyToCast() {
		return !!this.championEffects?.cast && this.mana >= this.manaMax()
	}
	castAbility(elapsedMS: DOMHighResTimeStamp) {
		const spell = this.getCurrentSpell()
		if (spell) {
			this.championEffects?.cast?.(elapsedMS, spell, this)
		}
		this.mana = this.getBonuses(BonusKey.ManaRestore) //TODO delay until mana lock
	}

	jumpToBackline(elapsedMS: DOMHighResTimeStamp) {
		const [col, row] = this.activeHex
		const targetHex: HexCoord = [col, this.team === 0 ? BOARD_ROW_COUNT - 1 : 0]
		this.activeHex = getClosestHexAvailableTo(targetHex, state.units) ?? this.activeHex
		this.moveUntilMS = elapsedMS + BACKLINE_JUMP_MS
		this.collides = true
		this.applyStatusEffect(elapsedMS, StatusEffectType.stealth, BACKLINE_JUMP_MS)
	}

	banishUntil(ms: DOMHighResTimeStamp | null) {
		const banishing = ms != null
		this.interacts = !banishing
		this.banishUntilMS = ms ?? null
	}

	isAttackable() {
		return this.isInteractable() && !this.statusEffects.stealth.active
	}
	isInteractable() {
		return !this.dead && this.interacts
	}
	hasCollision() {
		return !this.dead && this.collides
	}

	isMoving(elapsedMS: DOMHighResTimeStamp) {
		return elapsedMS < this.moveUntilMS
	}

	gainHealth(elapsedMS: DOMHighResTimeStamp, amount: number) {
		const grievousWounds = this.getStatusEffect(elapsedMS, StatusEffectType.grievousWounds) ?? 1
		this.health = Math.min(this.healthMax, this.health + amount * grievousWounds)
	}

	setMana(amount: number) {
		this.mana = Math.min(this.manaMax(), amount)
	}
	addMana(amount: number) {
		this.setMana(this.mana + amount)
	}
	gainMana(elapsedMS: DOMHighResTimeStamp, amount: number) {
		if (elapsedMS < this.manaLockUntilMS) {
			return
		}
		this.addMana(amount)
	}

	die() {
		this.health = 0
		this.dead = true
		const teamUnits = this.alliedUnits()
		if (teamUnits.length) {
			needsPathfindingUpdate()
			teamUnits.forEach(unit => {
				const increaseADAP = unit.getMutantBonus(MutantType.VoraciousAppetite, MutantBonus.VoraciousADAP)
				if (increaseADAP > 0) {
					unit.addBonuses(TraitKey.Mutant, [BonusKey.AttackDamage, increaseADAP], [BonusKey.AbilityPower, increaseADAP])
				}
			})
		} else {
			gameOver(this.team)
		}
	}

	damage(elapsedMS: DOMHighResTimeStamp, originalSource: boolean, source: ChampionUnit, sourceType: DamageSourceType, damageCalculation: SpellCalculation, isAOE: boolean, damageIncrease?: number, damageMultiplier?: number) {
		let [rawDamage, damageType] = solveSpellCalculationFor(this, damageCalculation)
		source.items.forEach((item, index) => {
			const modifyDamageFn = itemEffects[item.id as ItemKey]?.modifyDamageByHolder
			if (modifyDamageFn) {
				rawDamage = modifyDamageFn(item, originalSource, this, source, sourceType, rawDamage, damageType!)
			}
		})
		source.activeSynergies.forEach(([trait, style, activeEffect]) => {
			if (!activeEffect) { return }
			const modifyDamageFn = traitEffects[trait.name as TraitKey]?.modifyDamageByHolder
			if (modifyDamageFn) {
				rawDamage = modifyDamageFn(activeEffect, originalSource, this, source, sourceType, rawDamage, damageType!)
			}
		})

		if (damageType === DamageType.heal) {
			this.gainHealth(elapsedMS, rawDamage)
			return
		}
		if (sourceType === DamageSourceType.attack) {
			const dodgeChance = this.dodgeChance() - source.dodgePrevention()
			if (dodgeChance > 0) {
				rawDamage *= 1 - dodgeChance
			}
		}
		if (damageIncrease != null) {
			rawDamage += damageIncrease
		}
		if (rawDamage <= 0) {
			return
		}
		if (damageMultiplier != null) {
			rawDamage *= damageMultiplier
		}
		let defenseStat = damageType === DamageType.physical
			? this.armor()
			: damageType === DamageType.magic
				? this.magicResist()
				: null
		let reduction: number | undefined
		if (damageType === DamageType.physical) {
			reduction = this.getStatusEffect(elapsedMS, StatusEffectType.armorReduction)
		} else if (damageType === DamageType.magic) {
			reduction = this.getStatusEffect(elapsedMS, StatusEffectType.magicResistReduction)
		}
		if (reduction != null) {
			defenseStat! *= reduction
		}
		if (damageType === DamageType.physical || (damageType === DamageType.magic && (source.hasActive(TraitKey.Assassin) || source.hasItem(ItemKey.JeweledGauntlet)))) {
			const critReduction = this.critReduction()
			if (critReduction < 1) {
				const critDamage = rawDamage * source.critChance() * source.critMultiplier()
				rawDamage += critDamage * (1 - critReduction)
			}
		}
		const defenseMultiplier = defenseStat != null ? 100 / (100 + defenseStat) : 1
		let takingDamage = rawDamage * defenseMultiplier
		if (damageType !== DamageType.true) {
			const damageReduction = this.getBonuses(BonusKey.DamageReduction)
			if (damageReduction > 0) {
				if (damageReduction >= 1) {
					console.log('ERR', 'damageReduction must be between 0–1.')
				} else {
					takingDamage *= 1 - damageReduction
				}
			}
			if (isAOE) {
				const aoeDamageReduction = this.getStatusEffect(elapsedMS, StatusEffectType.aoeDamageReduction)
				if (aoeDamageReduction != null) {
					takingDamage *= 1 - aoeDamageReduction / 100
				}
			}
		}
		let healthDamage = takingDamage
		this.shields
			.filter(shield => shield.isSpellShield !== true)
			.forEach(shield => {
				const protectingDamage = Math.min(shield.amount, healthDamage)
				if (protectingDamage >= shield.amount) {
					if (shield.repeatsEveryMS != null) {
						shield.amount = 0
					} else {
						shield.activated = false
					}
				} else {
					shield.amount -= protectingDamage
				}
				healthDamage -= protectingDamage
			})
		if (this.health <= healthDamage) {
			this.die()
		} else {
			this.health -= healthDamage
			const manaGain = Math.min(42.5, rawDamage * 0.01 + takingDamage * 0.07) //TODO verify https://leagueoflegends.fandom.com/wiki/Mana_(Teamfight_Tactics)#Mechanic
			this.gainMana(elapsedMS, manaGain)
		}

		// `source` effects

		const sourceVamp = source.getVamp(damageType!, sourceType)
		if (sourceVamp > 0) {
			source.gainHealth(elapsedMS, takingDamage * sourceVamp / 100)
		}

		source.items.forEach((item, index) => itemEffects[item.id as ItemKey]?.damageDealtByHolder?.(item, uniqueIdentifier(index, item), elapsedMS, originalSource, this, source, sourceType, rawDamage, takingDamage, damageType!))
		this.items.forEach((item, index) => {
			const uniqueID = uniqueIdentifier(index, item)
			itemEffects[item.id as ItemKey]?.damageTaken?.(elapsedMS, item, uniqueID, originalSource, this, source, sourceType, rawDamage, takingDamage, damageType!)
			const hpThresholdFn = itemEffects[item.id as ItemKey]?.hpThreshold
			if (hpThresholdFn && this.checkHPThreshold(uniqueID, item.effects)) {
				hpThresholdFn(elapsedMS, item, uniqueID, this)
			}
		})
		this.activeSynergies.forEach(([trait, style, activeEffect]) => {
			if (!activeEffect) { return }
			const hpThresholdFn = traitEffects[trait.name as TraitKey]?.hpThreshold
			if (hpThresholdFn && this.checkHPThreshold(trait.name, activeEffect?.variables)) {
				hpThresholdFn(activeEffect, elapsedMS, this)
			}
		})
		source.activeSynergies.forEach(([trait, style, activeEffect]) => {
			if (!activeEffect) { return }
			traitEffects[trait.name as TraitKey]?.damageDealtByHolder?.(activeEffect, elapsedMS, originalSource, this, source, sourceType, rawDamage, takingDamage, damageType!)
		})

		if (sourceType === DamageSourceType.attack) {
			source.shields.forEach(shield => {
				if (shield.activated !== false && shield.bonusDamage) {
					this.damage(elapsedMS, false, source, DamageSourceType.trait, shield.bonusDamage, false)
				}
			})
		}
	}

	checkHPThreshold(uniqueID: string, effects: EffectVariables) {
		const hpThreshold = effects['HPThreshold']
		if (hpThreshold != null) {
			const activatedAt = thresholdCheck[uniqueID]
			if (activatedAt !== hpThreshold && this.healthProportion() <= hpThreshold / 100) {
				thresholdCheck[uniqueID] = hpThreshold
				const damageReduction = effects[BonusKey.DamageReduction]
				if (damageReduction != null) {
					if (damageReduction === 100) {
						this.health = this.healthMax * hpThreshold / 100
					} else {
						console.log('ERR', uniqueID, effects, BonusKey.DamageReduction)
					}
				}
				return true
			}
		} else {
			console.log('ERR', 'HPThreshold', uniqueID, effects)
		}
		return false
	}

	consumeSpellShield() {
		const shield = this.shields
			.filter(shield => shield.activated !== false && shield.isSpellShield === true)
			.sort((a, b) => a.amount - b.amount)[0] as ShieldData | undefined
		if (shield && shield.amount > 0) {
			shield.activated = false
		}
		return shield
	}

	alliedUnits(): ChampionUnit[] {
		return state.units.filter(unit => unit !== this && !unit.dead && unit.team === this.team)
	}

	hexDistanceTo(unit: ChampionUnit) {
		return this.hexDistanceToHex(unit.activeHex)
	}
	hexDistanceToHex(hex: HexCoord) {
		return hexDistanceFrom(this.activeHex, hex)
	}

	isAt(hex: HexCoord) {
		return isSameHex(this.activeHex, hex)
	}
	isStartAt(hex: HexCoord) {
		return isSameHex(this.startHex, hex)
	}
	isIn(hexes: Iterable<HexCoord>) {
		return containsHex(this.activeHex, hexes)
	}

	reposition(hex: HexCoord) {
		this.startHex = hex
		this.team = hex[1] < BOARD_ROW_PER_SIDE_COUNT ? 0 : 1
		window.setTimeout(saveUnits)
	}
	coordinatePosition() {
		return coordinatePosition(this.activeHex)
	}

	getStat(key: BonusKey) {
		if (key === BonusKey.AttackDamage) {
			return this.attackDamage()
		}
		if (key === BonusKey.AbilityPower) {
			return this.abilityPower()
		}
		if (key === BonusKey.Health) {
			return this.healthMax
		}

		if (key === BonusKey.MissingHealth) {
			return this.healthMax - this.health
		}
		console.log('ERR', 'Missing stat', key)
		return 0
	}

	getCurrentSpell(): ChampionSpellData | undefined {
		return this.data.spells[this.transformIndex]
	}

	getSpellVariable(key: SpellKey) {
		return this.getCurrentSpell()?.variables[key]?.[this.starLevel]
	}
	getSpellCalculationResult(key: SpellKey) {
		const calculation = this.getSpellCalculation(key)
		return calculation ? solveSpellCalculationFor(this, calculation)[0] : 0
	}
	getSpellCalculation(key: SpellKey) {
		const spell = this.getCurrentSpell()
		if (!spell) {
			console.log('ERR', 'No spell', this.name, key)
			return undefined
		}
		const calculation = spell.calculations[key]
		if (calculation == null) {
			console.log('ERR', 'Missing calculation for', spell.name, key)
			return undefined
		}
		return calculation
	}

	setBonusesFor(sourceKey: BonusLabelKey, ...bonuses: BonusVariable[]) {
		const existingBonuses = this.getBonusesFrom(sourceKey)
		const bonus = existingBonuses[0] ?? [sourceKey, []]
		if (existingBonuses[0] == null) {
			this.bonuses.push(bonus)
		}
		bonus[1] = bonuses
	}

	getBonusesFrom(sourceKey: BonusLabelKey) {
		return this.bonuses
			.filter(bonus => bonus[0] === sourceKey)
	}
	getBonusesFromKey(sourceKey: BonusLabelKey, bonusKey: BonusKey) {
		return this.getBonusesFrom(sourceKey)
			.flatMap(bonus => bonus[1])
			.filter(bonus => bonus[0] === bonusKey)
			.reduce((acc, bonus) => acc + (bonus[1] ?? 0), 0)
	}
	getBonusVariants(bonus: BonusKey) {
		return this.getBonuses(bonus, `Bonus${bonus}` as BonusKey, `${this.starLevel}Star${bonus}` as BonusKey)
	}
	getMutantBonus(mutantType: MutantType, bonus: MutantBonus) {
		if (state.mutantType !== mutantType) {
			return 0
		}
		return this.getBonuses(`Mutant${state.mutantType}${bonus}` as BonusKey)
	}
	getBonuses(...variableNames: BonusKey[]) {
		return this.bonuses
			.reduce((accumulator, bonus: [BonusLabelKey, BonusVariable[]]) => {
				const variables = bonus[1].filter(variable => variableNames.includes(variable[0] as BonusKey))
				return accumulator + variables.reduce((total, v) => total + (v[1] ?? 0), 0)
			}, 0)
	}

	hasActive(name: BonusLabelKey) {
		return !!this.bonuses.find(bonus => bonus[0] === name)
	}
	hasItem(key: ItemKey) {
		return !!this.items.find(item => item.id === key)
	}
	hasTrait(key: TraitKey) {
		return !!this.traits.find(trait => trait.name === key)
	}
	jumpsToBackline() {
		return this.hasTrait(TraitKey.Assassin)
	}

	attackDamage() {
		const ad = this.data.stats.damage * this.starMultiplier + this.getBonusVariants(BonusKey.AttackDamage) + this.getMutantBonus(MutantType.AdrenalineRush, MutantBonus.AdrenalineAD)
		const multiplier = this.getSpellVariable(SpellKey.ADFromAttackSpeed)
		if (multiplier != null) {
			return ad + this.bonusAttackSpeed() * 100 * multiplier
		}
		return ad
	}
	abilityPower() {
		const apBonus = this.getBonusVariants(BonusKey.AbilityPower) + this.getMutantBonus(MutantType.SynapticWeb, MutantBonus.SynapticAP)
		return 100 + apBonus
	}
	manaMax() {
		const maxManaMultiplier = this.getBonuses(BonusKey.ManaReductionPercent)
		const multiplier = maxManaMultiplier === 0 ? 1 : (1 - maxManaMultiplier)
		const maxManaReduction = this.getMutantBonus(MutantType.SynapticWeb, MutantBonus.SynapticManaCost)
		return (this.data.stats.mana - maxManaReduction) * multiplier
	}
	armor() {
		return this.data.stats.armor + this.getBonusVariants(BonusKey.Armor)
	}
	magicResist() {
		return this.data.stats.magicResist + this.getBonusVariants(BonusKey.MagicResist)
	}
	bonusAttackSpeed() {
		return this.getBonusVariants(BonusKey.AttackSpeed) / 100
	}
	attackSpeed() {
		return Math.min(5, this.fixedAS ?? this.data.stats.attackSpeed + this.bonusAttackSpeed())
	}
	range() {
		return this.data.stats.range + this.getBonuses(BonusKey.HexRangeIncrease)
	}
	moveSpeed() {
		return this.data.stats.moveSpeed //TODO Featherweights, Challengers
	}

	healthProportion() {
		return this.health / this.healthMax
	}

	dodgeChance() {
		return this.getBonuses(BonusKey.DodgeChance) / 100
	}
	dodgePrevention() {
		return this.getBonuses(BonusKey.AttackAccuracy) / 100
	}

	getVamp(damageType: DamageType, damageSource: DamageSourceType) {
		const vampBonuses = [BonusKey.VampOmni]
		if (damageSource !== DamageSourceType.item) {
			if (damageType === DamageType.physical) {
				vampBonuses.push(BonusKey.VampPhysical)
			}
			if (damageType === DamageType.magic || damageType === DamageType.true) {
				vampBonuses.push(BonusKey.VampSpell)
			}
		}
		return this.getBonuses(...vampBonuses)
	}

	getUnitsIn(hexes: HexCoord[], team: TeamNumber | null): ChampionUnit[] {
		return state.units.filter(unit => {
			if (team != null && unit.team !== team) {
				return false
			}
			return unit.isIn(hexes)
		})
	}
	getUnitsWithin(distance: number, team: TeamNumber | null): ChampionUnit[] {
		const hexes = getSurroundingWithin(this.activeHex, distance)
		return this.getUnitsIn(hexes, team)
	}

	queueBonus(elapsedMS: DOMHighResTimeStamp, startsAfterMS: DOMHighResTimeStamp, bonusLabel: BonusLabelKey, ...variables: BonusVariable[]) {
		this.pending.bonuses.add([elapsedMS + startsAfterMS, bonusLabel, variables])
	}
	queueProjectile(elapsedMS: DOMHighResTimeStamp, spell: ChampionSpellData | undefined, data: ProjectileData) {
		if (!data.damageCalculation) {
			data.damageCalculation = this.getSpellCalculation(SpellKey.Damage)
		}
		if (!data.sourceType && spell) {
			data.sourceType = DamageSourceType.spell
		}
		if (data.target == null) {
			if (!this.target) {
				console.error('ERR', 'No target for projectile', this.name, spell?.name)
				return
			}
			data.target = this.target
		}
		const projectile = new Projectile(this, elapsedMS, data, spell)
		this.pending.projectiles.add(projectile)
		this.attackStartAtMS = projectile.startsAtMS
		if (spell) {
			this.manaLockUntilMS = projectile.startsAtMS + DEFAULT_MANA_LOCK_MS
		}
	}
	queueHexEffect(elapsedMS: DOMHighResTimeStamp, spell: ChampionSpellData | undefined, data: HexEffectData) {
		if (spell && data.damageCalculation === undefined) {
			data.damageCalculation = this.getSpellCalculation(SpellKey.Damage)
		}
		if (data.damageCalculation && !data.damageSourceType) {
			data.damageSourceType = DamageSourceType.spell
		}
		const hexEffect = new HexEffect(this, elapsedMS, spell, data)
		this.pending.hexEffects.add(hexEffect)
		this.attackStartAtMS = hexEffect.activatesAtMS
		this.manaLockUntilMS = hexEffect.activatesAtMS + DEFAULT_MANA_LOCK_MS
	}
}
