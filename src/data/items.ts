import { BonusKey, DamageType } from '@tacticians-academy/academy-library'
import type { ItemData } from '@tacticians-academy/academy-library'

import { ItemKey } from '@tacticians-academy/academy-library/dist/set6/items'

import type { ChampionUnit } from '#/game/ChampionUnit'
import { activatedCheck, state } from '#/game/store'

import { getInteractableUnitsOfTeam } from '#/helpers/abilityUtils'
import { getClosesUnitOfTeamTo, getInverseHex } from '#/helpers/boardUtils'
import { createDamageCalculation } from '#/helpers/bonuses'
import { DamageSourceType, StatusEffectType } from '#/helpers/types'
import type { BonusScaling, BonusVariable, EffectResults, ShieldData } from '#/helpers/types'

interface ItemFns {
	adjacentHexBuff?: (item: ItemData, unit: ChampionUnit, adjacentUnits: ChampionUnit[]) => EffectResults,
	apply?: (item: ItemData, unit: ChampionUnit) => EffectResults,
	disableDefaultVariables?: true | BonusKey[]
	innate?: (item: ItemData, unit: ChampionUnit) => EffectResults,
	update?: (elapsedMS: DOMHighResTimeStamp, item: ItemData, itemID: string, unit: ChampionUnit) => EffectResults,
	damageDealtByHolder?: (item: ItemData, itemID: string, elapsedMS: DOMHighResTimeStamp, originalSource: boolean, target: ChampionUnit, source: ChampionUnit, sourceType: DamageSourceType, rawDamage: number, takingDamage: number, damageType: DamageType) => void
	modifyDamageByHolder?: (item: ItemData, originalSource: boolean, target: ChampionUnit, source: ChampionUnit, sourceType: DamageSourceType, rawDamage: number, damageType: DamageType) => number
	basicAttack?: (elapsedMS: DOMHighResTimeStamp, item: ItemData, itemID: string, target: ChampionUnit, source: ChampionUnit, canReProc: boolean) => void
	damageTaken?: (elapsedMS: DOMHighResTimeStamp, item: ItemData, itemID: string, originalSource: boolean, target: ChampionUnit, source: ChampionUnit, sourceType: DamageSourceType, rawDamage: number, takingDamage: number, damageType: DamageType) => void
	hpThreshold?: (elapsedMS: DOMHighResTimeStamp, item: ItemData, itemID: string, unit: ChampionUnit) => void
}

function checkCooldown(elapsedMS: DOMHighResTimeStamp, item: ItemData, itemID: string, instantlyApplies: boolean, cooldownKey: string = 'ICD') {
	const activatedAtMS = activatedCheck[itemID]
	const itemCooldownSeconds = item.effects[cooldownKey]
	if (itemCooldownSeconds == null) {
		console.log('ERR icd', item.name, item.effects)
		return true
	}
	if (activatedAtMS != null && elapsedMS < activatedAtMS + itemCooldownSeconds * 1000) {
		return false
	}
	activatedCheck[itemID] = elapsedMS
	return instantlyApplies ? true : activatedAtMS != null
}

export default {

	[ItemKey.ArchangelsStaff]: {
		innate: (item, unit) => {
			const scalings: BonusScaling[] = []
			const intervalAmount = item.effects['APPerInterval']
			const intervalSeconds = item.effects['IntervalSeconds']
			if (intervalAmount != null && intervalSeconds != null) {
				scalings.push({
					activatedAt: 0,
					source: item.name,
					stats: [BonusKey.AbilityPower],
					intervalAmount,
					intervalSeconds,
				})
			} else {
				return console.log('ERR', item.name, item.effects)
			}
			return { scalings }
		},
	},

	[ItemKey.BansheesClaw]: {
		adjacentHexBuff: (item, unit, adjacentUnits) => {
			const damageCap = item.effects['DamageCap']
			if (damageCap == null) {
				return console.log('ERR', item.name, item.effects)
			}
			adjacentUnits.push(unit)
			adjacentUnits.forEach(unit => unit.shields.push({
				isSpellShield: true,
				amount: damageCap,
			}))
		},
	},

	[ItemKey.Bloodthirster]: {
		hpThreshold: (elapsedMS, item, itemID, unit) => {
			const shieldHPPercent = item.effects['ShieldHPPercent']
			const shieldDurationSeconds = item.effects['ShieldDuration']
			if (shieldHPPercent == null || shieldDurationSeconds == null) {
				return console.log('ERR', item.name, item.effects)
			}
			unit.shields.push({
				amount: shieldHPPercent / 100 * unit.healthMax,
				expiresAtMS: elapsedMS + shieldDurationSeconds * 1000,
			})
		},
	},

	[ItemKey.BrambleVest]: {
		damageTaken: (elapsedMS, item, itemID, originalSource, target, source, sourceType, rawDamage, takingDamage, damageType) => {
			if (originalSource && sourceType === DamageSourceType.attack && checkCooldown(elapsedMS, item, itemID, true)) {
				const aoeDamage = item.effects[`${target.starLevel}StarAoEDamage`]
				if (aoeDamage == null) {
					return console.log('ERR', item.name, item.effects)
				}
				target.getUnitsWithin(1, target.opposingTeam()).forEach(unit => {
					const damageCalculation = createDamageCalculation(item.name, aoeDamage, DamageType.magic)
					unit.damage(elapsedMS, false, target, DamageSourceType.item, damageCalculation, true)
				})
			}
		},
	},

	[ItemKey.ChaliceOfPower]: {
		adjacentHexBuff: (item, unit, adjacentUnits) => {
			const bonusAP = item.effects['BonusAP']
			if (bonusAP == null) {
				return console.log('ERR', item.name, item.effects)
			}
			adjacentUnits.forEach(unit => unit.addBonuses(item.id as ItemKey, [BonusKey.AbilityPower, bonusAP]))
		},
	},

	[ItemKey.DragonsClaw]: {
		damageTaken: (elapsedMS, item, itemID, originalSource, target, source, sourceType, rawDamage, takingDamage, damageType) => {
			if (originalSource && sourceType === DamageSourceType.spell && damageType !== DamageType.physical && checkCooldown(elapsedMS, item, itemID, true)) {
				target.queueProjectile(elapsedMS, undefined, {
					target: source,
					damageCalculation: createDamageCalculation(item.name, 0.18, DamageType.magic, BonusKey.Health, 1),
					sourceType: DamageSourceType.item,
					startsAfterMS: 0,
					missile: {
						speedInitial: 500, //TODO experimentally determine
					},
				})
			}
		},
	},

	[ItemKey.EdgeOfNight]: {
		disableDefaultVariables: [BonusKey.AttackSpeed, BonusKey.DamageReduction],
		hpThreshold: (elapsedMS, item, itemID, unit) => {
			const attackSpeed = item.effects[BonusKey.AttackSpeed]
			const stealthDuration = item.effects['StealthDuration']
			if (attackSpeed == null || stealthDuration == null) {
				return console.log('ERR', item.name, item.effects)
			}
			const stealthMS = stealthDuration * 1000
			const negativeEffects = [StatusEffectType.armorReduction, StatusEffectType.attackSpeedSlow, StatusEffectType.grievousWounds]
			negativeEffects.forEach(statusEffect => unit.statusEffects[statusEffect].active = false)
			unit.applyStatusEffect(elapsedMS, StatusEffectType.stealth, stealthMS)
			unit.queueBonus(elapsedMS, stealthMS, ItemKey.EdgeOfNight, [BonusKey.AttackSpeed, attackSpeed])
		},
	},

	[ItemKey.FrozenHeart]: {
		update: (elapsedMS, item, itemID, unit) => {
			const slowAS = item.effects['ASSlow']
			const hexRadius = item.effects['HexRadius']
			const durationSeconds = 0.5 //NOTE hardcoded apparently??
			if (hexRadius == null || slowAS == null) {
				return console.log('ERR', item.name, item.effects)
			}
			const affectedUnits = unit.getUnitsWithin(hexRadius, unit.opposingTeam())
			affectedUnits.forEach(unit => unit.applyStatusEffect(elapsedMS, StatusEffectType.attackSpeedSlow, durationSeconds * 1000, slowAS))
		},
	},

	[ItemKey.GargoyleStoneplate]: {
		update: (elapsedMS, item, itemID, unit) => {
			const perEnemyArmor = item.effects['ArmorPerEnemy']
			const perEnemyMR = item.effects['MRPerEnemy']
			if (perEnemyArmor == null || perEnemyMR == null) {
				return console.log('ERR', item.name, item.effects)
			}
			const unitsTargeting = getInteractableUnitsOfTeam(unit.opposingTeam())
				.filter(enemy => enemy.target === unit)
				.length
			unit.setBonusesFor(itemID as any, [BonusKey.Armor, perEnemyArmor * unitsTargeting], [BonusKey.MagicResist, perEnemyMR * unitsTargeting])
		},
	},

	[ItemKey.GiantSlayer]: {
		modifyDamageByHolder: (item, originalSource, target, source, sourceType, rawDamage, damageType) => {
			if (!originalSource || (sourceType !== DamageSourceType.attack && sourceType !== DamageSourceType.spell)) {
				return rawDamage
			}
			const thresholdHP = item.effects['HPThreshold']
			const largeBonusPct = item.effects['LargeBonusPct']
			const smallBonusPct = item.effects['SmallBonusPct']
			if (thresholdHP == null || smallBonusPct == null || largeBonusPct == null) {
				console.log('ERR', item.name, item.effects)
				return rawDamage
			}
			const bonusPercent = target.healthMax >= thresholdHP ? largeBonusPct : smallBonusPct
			return rawDamage * (1 + bonusPercent / 100)
		},
	},

	[ItemKey.GuinsoosRageblade]: {
		basicAttack: (elapsedMS, item, itemID, target, source, canReProc) => {
			const perStackAS = item.effects['ASPerStack']
			if (perStackAS == null) {
				return console.log('ERR', item.name, item.effects)
			}
			source.addBonuses(itemID as any, [BonusKey.AttackSpeed, perStackAS])
		},
	},

	[ItemKey.HandOfJustice]: {
		damageDealtByHolder: (item, itemID, elapsedMS, originalSource, target, source, sourceType, rawDamage, takingDamage, damageType) => {
			if (sourceType === DamageSourceType.attack || sourceType === DamageSourceType.spell) {
				const baseHeal = item.effects['BaseHeal']
				const increaseEffect = item.effects['AdditionalAP'] //TODO renamed
				if (baseHeal == null || increaseEffect == null) {
					return console.log('ERR', item.name, item.effects)
				}
				source.gainHealth(elapsedMS, takingDamage * (baseHeal + increaseEffect / 2) / 100) //TODO averaged increaseEffect
			}
		},
		innate: (item, unit) => {
			const variables: BonusVariable[] = []
			const increaseEffect = item.effects['AdditionalAD'] //TODO renamed
			if (increaseEffect != null) {
				const increase = increaseEffect / 2 //TODO averaged increaseEffect
				variables.push([BonusKey.AbilityPower, increase], [BonusKey.AttackDamage, increase])
			} else {
				console.log('ERR', item.name, item.effects)
			}
			return { variables }
		},
	},

	[ItemKey.HextechGunblade]: {
		damageDealtByHolder: (item, itemID, elapsedMS, originalSource, target, source, sourceType, rawDamage, takingDamage, damageType) => {
			if (damageType !== DamageType.physical) {
				const hextechHeal = item.effects[BonusKey.VampSpell]
				if (hextechHeal == null) {
					return console.log('ERR', item.name, item.effects)
				}
				let lowestHP = Number.MAX_SAFE_INTEGER
				let lowestUnit: ChampionUnit | undefined
				source.alliedUnits().forEach(unit => {
					if (unit.health < lowestHP) {
						lowestHP = unit.health
						lowestUnit = unit
					}
				})
				if (lowestUnit) {
					lowestUnit.gainHealth(elapsedMS, takingDamage * hextechHeal / 100)
				}
			}
		},
	},

	[ItemKey.LastWhisper]: {
		damageDealtByHolder: (item, itemID, elapsedMS, originalSource, target, source, sourceType, rawDamage, takingDamage, damageType) => {
			//TODO official implementation applies on critical strikes, this applies after any attack (since crits are averaged)
			const armorReductionPercent = item.effects['ArmorReductionPercent']
			const durationSeconds = item.effects['ArmorBreakDuration']
			if (armorReductionPercent == null || durationSeconds == null) {
				return console.log('ERR', item.name, item.effects)
			}
			target.applyStatusEffect(elapsedMS, StatusEffectType.armorReduction, durationSeconds * 1000, armorReductionPercent / 100)
		},
	},

	[ItemKey.LocketOfTheIronSolari]: {
		adjacentHexBuff: (item, unit, adjacentUnits) => {
			const shieldValue = item.effects[`${unit.starLevel}StarShieldValue`]
			const shieldDuration = item.effects['ShieldDuration']
			if (shieldValue == null || shieldDuration == null) {
				return console.log('ERR', item.name, item.effects)
			}
			adjacentUnits.push(unit)
			adjacentUnits.forEach(unit => unit.shields.push({
				amount: shieldValue,
				expiresAtMS: shieldDuration * 1000,
			}))
		},
	},

	[ItemKey.Morellonomicon]: {
		damageDealtByHolder: (item, itemID, elapsedMS, originalSource, target, source, sourceType, rawDamage, takingDamage, damageType) => {
			if (originalSource && sourceType === DamageSourceType.spell && (damageType === DamageType.magic || damageType === DamageType.true)) {
				const grievousWounds = item.effects['GrievousWoundsPercent']
				const totalBurn = item.effects['BurnPercent']
				const durationSeconds = item.effects['BurnDuration']
				const ticksPerSecond = item.effects['TicksPerSecond']
				if (grievousWounds == null || totalBurn == null || durationSeconds == null || ticksPerSecond == null) {
					return console.log('ERR', item.name, item.effects)
				}
				target.applyStatusEffect(elapsedMS, StatusEffectType.grievousWounds, durationSeconds * 1000, grievousWounds / 100)

				const sourceID = 'BURN'
				const existing = Array.from(target.bleeds).find(bleed => bleed.sourceID === sourceID)
				const repeatsEverySeconds = 1 / ticksPerSecond
				const repeatsEveryMS = repeatsEverySeconds * 1000
				const tickCount = durationSeconds / repeatsEverySeconds
				const damage = totalBurn / tickCount / 100
				const damageCalculation = createDamageCalculation(sourceID, damage, DamageType.true, BonusKey.Health, 1)
				if (existing) {
					existing.remainingIterations = tickCount
					existing.damageCalculation = damageCalculation
					existing.source = source
					existing.repeatsEveryMS = repeatsEveryMS
				} else {
					target.bleeds.add({
						sourceID,
						source,
						damageCalculation,
						activatesAtMS: elapsedMS + repeatsEveryMS,
						repeatsEveryMS,
						remainingIterations: tickCount,
					})
				}
			}
		},
	},

	[ItemKey.TitansResolve]: {
		basicAttack: (elapsedMS, item, itemID, target, source, canReProc) => {
			applyTitansResolve(item, itemID, source)
		},
		damageTaken: (elapsedMS, item, itemID, originalSource, target, source, sourceType, rawDamage, takingDamage, damageType) => {
			if (originalSource) {
				applyTitansResolve(item, itemID, target)
			}
		},
	},

	[ItemKey.Quicksilver]: {
		apply: (item, unit) => {
			const shields: ShieldData[] = []
			const shieldDuration = item.effects['SpellShieldDuration']
			if (shieldDuration != null) {
				shields.push({
					isSpellShield: true,
					amount: 0, //TODO does not break
					expiresAtMS: shieldDuration * 1000,
				})
			} else {
				return console.log('ERR', item.name, item.effects)
			}
			return { shields }
		},
	},

	[ItemKey.Redemption]: {
		update: (elapsedMS, item, itemID, unit) => {
			if (checkCooldown(elapsedMS, item, itemID, true, 'HealTickRate')) {
				const aoeDamageReduction = item.effects['AoEDamageReduction']
				const missingHPHeal = item.effects['MissingHPHeal']
				const maxHeal = item.effects['MaxHeal']
				const hexDistanceFromSource = item.effects['HexRadius']
				const healTickSeconds = item.effects['HealTickRate']
				if (aoeDamageReduction == null || hexDistanceFromSource == null || missingHPHeal == null || maxHeal == null || healTickSeconds == null) {
					return console.log('ERR', item.name, item.effects)
				}
				const tickMS = healTickSeconds * 1000
				unit.queueHexEffect(elapsedMS, undefined, {
					startsAfterMS: tickMS,
					hexDistanceFromSource,
					statusEffects: {
						[StatusEffectType.aoeDamageReduction]: {
							durationMS: tickMS,
							amount: aoeDamageReduction,
						},
					},
					damageCalculation: createDamageCalculation(itemID, missingHPHeal / 100, DamageType.heal, BonusKey.MissingHealth, 1, false, maxHeal),
					targetTeam: unit.team,
				})
			}
		},
	},

	[ItemKey.ZekesHerald]: {
		adjacentHexBuff: (item, unit, adjacentUnits) => {
			const bonusAS = item.effects['AS']
			if (bonusAS == null) {
				return console.log('ERR', item.name, item.effects)
			}
			adjacentUnits.forEach(unit => unit.addBonuses(item.id as ItemKey, [BonusKey.AttackSpeed, bonusAS]))
		},
	},

	[ItemKey.Zephyr]: {
		apply: (item, unit) => {
			const banishDuration = item.effects['BanishDuration']
			if (banishDuration == null) {
				return console.log('ERR', item.name, item.effects)
			}
			const targetHex = getInverseHex(unit.startHex)
			const target = getClosesUnitOfTeamTo(targetHex, unit.opposingTeam(), state.units) //TODO not random
			if (target) {
				target.banishUntil(banishDuration * 1000)
			}
		},
	},

} as { [key in ItemKey]?: ItemFns }

function applyTitansResolve(item: ItemData, itemID: any, unit: ChampionUnit) {
	const stackAD = item.effects['StackingAD']
	const stackAP = item.effects['StackingAP']
	const maxStacks = item.effects['StackCap']
	const resistsAtCap = item.effects['BonusResistsAtStackCap']
	if (stackAD == null || stackAP == null || maxStacks == null || resistsAtCap == null) {
		return console.log('ERR', item.name, item.effects)
	}
	const bonuses = unit.getBonusesFrom(itemID)
	if (bonuses.length < maxStacks) {
		const variables: BonusVariable[] = []
		variables.push([BonusKey.AttackDamage, stackAD], [BonusKey.AbilityPower, stackAP])
		if (bonuses.length === maxStacks - 1) {
			variables.push([BonusKey.Armor, resistsAtCap], [BonusKey.MagicResist, resistsAtCap])
		}
		unit.addBonuses(itemID, ...variables)
	}
}
