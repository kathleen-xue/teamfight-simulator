<script setup lang="ts">
import DisplayTrait from '#/components/Sidebar/DisplayTrait.vue'

import { useStore } from '#/game/store'

import { getTeamName } from '#/helpers/boardUtils'
import { MutantType } from '#/helpers/types'

const { getters: { synergiesByTeam }, state } = useStore()
</script>

<template>
<div class="p-1">
	<form>
		<fieldset :disabled="state.isRunning">
			<div>
				<label for="select-stage" class="mr-1">Stage:</label>
				<select id="select-stage" v-model="state.stageNumber">
					<option v-for="stageNumber in 9" :key="stageNumber">{{ stageNumber }}</option>
				</select>
			</div>
			<div>
				<label for="select-mutant" class="mr-1">Mutants:</label>
				<select id="select-mutant" v-model="state.mutantType">
					<option v-for="type in MutantType" :key="type">{{ type }}</option>
				</select>
			</div>
		</fieldset>
	</form>
	<div v-for="(teamSynergies, teamIndex) in synergiesByTeam" :key="teamIndex">
		<div class="font-semibold">Team {{ getTeamName(teamIndex) }}</div>
		<div v-for="[trait, style, currentEffect, unitNames] in teamSynergies" :key="trait.name">
			<DisplayTrait v-if="style > 0" :trait="trait" :activeStyle="style" :activeEffect="currentEffect" :units="unitNames" />
		</div>
		<div class="text-secondary text-sm">
			<template v-for="[trait, style] in teamSynergies" :key="trait.name">
				<span v-if="style === 0">{{ trait.name }}, </span>
			</template>
		</div>
	</div>
</div>
</template>
