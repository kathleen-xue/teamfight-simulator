import type { TraitKey } from '@tacticians-academy/academy-library/dist/set6/traits'

import type { ChampionUnit } from '#/game/ChampionUnit'
import { state } from '#/game/store'

import { BOARD_COL_COUNT } from '#/helpers/constants'
import type { HexCoord, TeamNumber } from '#/helpers/types'
import { getArrayValueCounts, randomItem } from '#/helpers/utils'

export function getUnitsOfTeam(team: TeamNumber | null) {
	return state.units.filter(unit => (team == null || unit.team === team))
}

export function getAliveUnitsOfTeam(team: TeamNumber | null) {
	return state.units.filter(unit => !unit.dead && (team == null || unit.team === team))
}
export function getAliveUnitsOfTeamWithTrait(team: TeamNumber | null, trait: TraitKey) {
	return getAliveUnitsOfTeam(team).filter(unit => unit.hasTrait(trait))
}
export function getAttackableUnitsOfTeam(team: TeamNumber | null) {
	return state.units.filter(unit => (team == null || unit.team === team) && unit.isAttackable())
}
export function getInteractableUnitsOfTeam(team: TeamNumber | null) {
	return state.units.filter(unit => (team == null || unit.team === team) && unit.isInteractable())
}

export function getRowOfMostAttackable(team: TeamNumber | null) {
	const units = getAttackableUnitsOfTeam(team)
	const unitRows = units.map(unit => unit.activeHex[1])
	const unitsPerRow = getArrayValueCounts(unitRows)
	const maxUnitsInRowCount = unitsPerRow.reduce((previous, current) => Math.max(previous, current[1]), 0)
	const randomRowTarget = randomItem(unitsPerRow.filter(row => row[1] === maxUnitsInRowCount))
	const row = randomRowTarget ? parseInt(randomRowTarget[0], 10) : 0
	return [...Array(BOARD_COL_COUNT).keys()].map((col): HexCoord => [col, row])
}

export function getDistanceUnit(closest: boolean, fromUnit: ChampionUnit, team?: TeamNumber | null) {
	const units = getInteractableUnitsOfTeam(team === undefined ? fromUnit.opposingTeam() : team)
	let bestUnit: ChampionUnit | undefined
	let bestDistance = closest ? 99 : 0
	for (const targetUnit of units) {
		if (targetUnit !== fromUnit) {
			const distance = fromUnit.hexDistanceTo(targetUnit)
			if (closest ? distance < bestDistance : distance > bestDistance) {
				bestDistance = distance
				bestUnit = targetUnit
			}
		}
	}
	return bestUnit
}
