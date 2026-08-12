<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource-variable/montserrat';
	import '@fontsource/bebas-neue';
	import '@fontsource/playfair-display/700.css';
	import '@fontsource/space-grotesk/600.css';
	import './layout.css';

	let { children } = $props();
</script>

{@render children()}

<style>
	@import url('https://fonts.cdnfonts.com/css/sf-pro-display');
	:global(body) {
		font-family: 'SF Pro Display', sans-serif;
		margin: 0;
		padding: 0;
		justify-content: center;
	}
</style>
