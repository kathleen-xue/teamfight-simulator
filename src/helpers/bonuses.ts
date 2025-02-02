import { BonusKey, DamageType } from '@tacticians-academy/academy-library'
import type { ItemData, SpellCalculation } from '@tacticians-academy/academy-library'

import type { ItemKey } from '@tacticians-academy/academy-library/dist/set6/items'
import type { TraitKey } from '@tacticians-academy/academy-library/dist/set6/traits'

import itemEffects from '#/data/items'
import traitEffects from '#/data/set6/traits'

import type { ChampionUnit } from '#/game/ChampionUnit'

import { TEAM_EFFECT_TRAITS } from '#/helpers/constants'
import type { BonusLabelKey, BonusScaling, BonusVariable, ShieldData, SynergyData, TeamNumber } from '#/helpers/types'

export const synergiesByTeam: SynergyData[][] = []

function getInnateEffectForUnitWith(trait: TraitKey, teamSynergies: SynergyData[]) {
	const synergy = teamSynergies.find(synergy => synergy[0].name === trait)
	return synergy?.[2] ?? synergy?.[0].effects[0]
}

type BonusResults = [[BonusLabelKey, BonusVariable[]][], BonusScaling[], ShieldData[]]

export function createDamageCalculation(variable: string, value: number, damageType: DamageType | undefined, stat?: BonusKey, ratio?: number, asPercent?: boolean, maximum?: number): SpellCalculation {
	return {
		asPercent: asPercent,
		damageType: damageType,
		parts: [{
			subparts: [{
				variable: variable,
				starValues: [value, value, value, value],
				stat,
				ratio,
				max: maximum,
			}],
		}],
	}
}

export function solveSpellCalculationFor(unit: ChampionUnit, calculation: SpellCalculation): [value: number, damageType: DamageType | undefined] {
	let damageType = calculation.damageType
	const total = calculation.parts.reduce((acc, part) => {
		const multiplyParts = part.operator === 'product'
		return acc + part.subparts.reduce((subAcc, subpart) => {
			let value = subpart.starValues[unit.starLevel]
			if (subpart.stat != null) {
				if (subpart.stat === BonusKey.AttackDamage) {
					damageType = DamageType.physical
				}
				if (subpart.stat === BonusKey.AttackDamage) {
					damageType = DamageType.physical
				} else if (!damageType && subpart.stat === BonusKey.AbilityPower) {
					damageType = DamageType.magic
				}
				value *= unit.getStat(subpart.stat as BonusKey) * subpart.ratio!
			}
			if (subpart.max != null) {
				value = Math.min(subpart.max, value)
			}
			return multiplyParts ? (subAcc * value) : (subAcc + value)
		}, multiplyParts ? 1 : 0)
	}, 0)
	return [calculation.asPercent === true ? total * 100 : total, damageType]
}

export function calculateSynergyBonuses(unit: ChampionUnit, teamSynergies: SynergyData[], unitTraitKeys: TraitKey[]): BonusResults {
	const bonuses: [TraitKey, BonusVariable[]][] = []
	const bonusScalings: BonusScaling[] = []
	const bonusShields: ShieldData[] = []
	teamSynergies.forEach(([trait, style, activeEffect]) => {
		if (activeEffect == null) {
			return
		}

		const teamEffect = TEAM_EFFECT_TRAITS[trait.apiName]
		const unitHasTrait = unitTraitKeys.includes(trait.name as TraitKey)
		const bonusVariables: BonusVariable[] = []
		const traitEffectData = traitEffects[trait.name as TraitKey]
		const teamTraitFn = traitEffectData?.team
		if (teamTraitFn) {
			const { variables, scalings, shields } = teamTraitFn(unit, activeEffect)
			if (variables) { bonusVariables.push(...variables) }
			if (scalings) { bonusScalings.push(...scalings) }
			if (shields) { bonusShields.push(...shields) }
		}
		if (teamEffect != null || unitHasTrait) {
			// console.log(trait.name, teamEffect, activeEffect.variables)
			const disableDefaultVariables = traitEffectData?.disableDefaultVariables
			for (let key in activeEffect.variables) {
				if (disableDefaultVariables != null && (disableDefaultVariables === true || disableDefaultVariables.includes(key as BonusKey))) {
					continue
				}
				let value = activeEffect.variables[key]
				if (unitHasTrait) {
					if (teamEffect === false) {
						if (key.startsWith('Team')) {
							key = key.replace('Team', '')
						} else if (key.startsWith(trait.name)) {
							key = key.replace(trait.name, '')
						} else {
							console.warn('Unknown key for Team /', trait.name)
							continue
						}
					}
					if (value != null) {
						if (typeof teamEffect === 'number') {
							value *= teamEffect
						}
					}
				} else {
					if (teamEffect === false) {
						if (!key.startsWith('Team')) {
							continue
						}
						key = key.replace('Team', '')
					} else if (typeof teamEffect === 'object') {
						if (!teamEffect.includes(key as BonusKey)) {
							continue
						}
					}
				}
				bonusVariables.push([key, value])
			}
		}
		if (unitHasTrait) {
			const soloTraitFn = traitEffectData?.solo
			if (soloTraitFn) {
				const { variables, scalings, shields } = soloTraitFn(unit, activeEffect)
				if (variables) { bonusVariables.push(...variables) }
				if (scalings) { bonusScalings.push(...scalings) }
				if (shields) { bonusShields.push(...shields) }
			}
		}
		if (bonusVariables.length) {
			bonuses.push([trait.name as TraitKey, bonusVariables])
		}
	})
	for (const trait of unitTraitKeys) {
		const innateTraitFn = traitEffects[trait]?.innate
		if (innateTraitFn) {
			const innateEffect = getInnateEffectForUnitWith(trait, teamSynergies)
			if (innateEffect) {
				const { variables, scalings, shields } = innateTraitFn(unit, innateEffect)
				if (variables) { bonuses.push([trait, variables]) }
				if (scalings) { bonusScalings.push(...scalings) }
				if (shields) { bonusShields.push(...shields) }
			}
		}
	}
	return [bonuses, bonusScalings, bonusShields]
}

export function calculateItemBonuses(unit: ChampionUnit, items: ItemData[]): BonusResults {
	const bonuses: [ItemKey, BonusVariable[]][] = []
	const bonusScalings: BonusScaling[] = []
	const bonusShields: ShieldData[] = []
	items.forEach(item => {
		const disableDefaultVariables = itemEffects[item.id as ItemKey]?.disableDefaultVariables
		const bonusVariables: BonusVariable[] = []
		for (const key in item.effects) {
			if (disableDefaultVariables != null && (disableDefaultVariables === true || disableDefaultVariables.includes(key as BonusKey))) {
				continue
			}
			bonusVariables.push([key, item.effects[key]])
		}

		const itemFn = itemEffects[item.id as ItemKey]?.innate
		if (itemFn) {
			const { variables, scalings, shields } = itemFn(item, unit)
			if (variables) { bonusVariables.push(...variables) }
			if (scalings) { bonusScalings.push(...scalings) }
			if (shields) { bonusShields.push(...shields) }
		}
		if (bonusVariables.length) {
			bonuses.push([item.id, bonusVariables])
		}
	})
	return [bonuses, bonusScalings, bonusShields]
}
