import { BonusKey } from '@tacticians-academy/academy-library'

import type { StarLevel } from '#/helpers/types'

export const DEFAULT_MANA_LOCK_MS = 1000

export const HEX_PROPORTION = 0.126
export const HEX_MOVE_LEAGUEUNITS = 180
export const HEX_PROPORTION_PER_LEAGUEUNIT = HEX_PROPORTION / HEX_MOVE_LEAGUEUNITS
export const BACKLINE_JUMP_MS = 600 //TODO up to date?

export const BOARD_ROW_PER_SIDE_COUNT = 4
export const BOARD_ROW_COUNT = BOARD_ROW_PER_SIDE_COUNT * 2
export const BOARD_COL_COUNT = 7

const SIDEBAR_UNITS_RAW = 26
const BOARD_UNITS_RAW = 100 - SIDEBAR_UNITS_RAW
const HEX_BORDER_PROPORTION = 0.5
const HEX_BORDER_SIZES_PROPORTION = (BOARD_COL_COUNT + 1) * HEX_BORDER_PROPORTION
export const HEX_SIZE_PROPORTION = (BOARD_UNITS_RAW - HEX_BORDER_SIZES_PROPORTION) / BOARD_COL_COUNT
export const UNIT_SIZE_HEX_PROPORTION = 0.75

export const SIDEBAR_UNITS = `${SIDEBAR_UNITS_RAW}vw`
export const HEX_BORDER_UNITS = `${HEX_BORDER_PROPORTION}vw`
export const HEX_UNITS = `${HEX_SIZE_PROPORTION}vw`
export const HALF_HEX_BORDER_UNITS = `${HEX_BORDER_PROPORTION / 2}vw`
export const HALF_HEX_UNITS = `${HEX_SIZE_PROPORTION / 2}vw`
export const QUARTER_HEX_INSET_UNITS = `-${HEX_SIZE_PROPORTION / 4}vw`
export const HEX_GAP_BETWEEN_SIDE_EDGES_UNITS = `${HEX_SIZE_PROPORTION / 4 + HEX_BORDER_PROPORTION}vw`

export const LOCKED_STAR_LEVEL_BY_UNIT_API_NAME: Record<string, StarLevel> = {
	TFT6_MalzaharVoidling: 1,
	TFT6_Tibbers: 2,
	TFT6_HexTechDragon: 3,
}

export const TEAM_EFFECT_TRAITS: Record<string, boolean | number | BonusKey[]> = {
	Set6_Arcanist: false,
	Set6_Bruiser: 2,
	// Set6_Clockwork: true,
	Set6_Enchanter: [BonusKey.MagicResist],
	// Set6_Scholar: true,
}
