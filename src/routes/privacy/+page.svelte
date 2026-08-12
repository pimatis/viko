<script lang="ts">
	import LegalPage from '../../components/home/LegalPage.svelte';
</script>

<svelte:head>
	<meta
		name="description"
		content="Viko privacy policy: all project data and media stay on your device in IndexedDB and localStorage. No accounts, no tracking, no cloud uploads."
	/>
	<meta property="og:type" content="website" />
	<meta property="og:title" content="Privacy policy - Viko" />
	<meta
		property="og:description"
		content="Viko is local-first: your projects and media never leave your browser. No accounts, no tracking, no cloud uploads."
	/>
	<meta property="og:url" content="https://github.com/pimatis/viko" />
	<meta name="robots" content="index, follow" />
</svelte:head>

<LegalPage
	title="Privacy policy"
	updated="August 12, 2026"
	lead="Viko is a local-first video editor. The editor, your media and your projects run entirely in your browser. This policy describes what data the app touches, where it lives and what never leaves your device."
	sections={[
		{
			heading: 'Data we store on your device',
			body: 'Viko uses two browser storage mechanisms, both local to your machine:',
			items: [
				'IndexedDB (a database named "viko"): your project document, up to 20 version snapshots and the raw media blobs you import. Media blobs are stored so projects remain available after a page reload.',
				'localStorage: small preference values, such as whether you dismissed the mobile notice and your UI sound preference.'
			]
		},
		{
			heading: 'What we never collect',
			body: 'Viko has no backend, no accounts and no telemetry. Nothing is sent to a server while you edit:',
			items: [
				'Your media files are never uploaded. Imports, previews and exports all happen in your browser.',
				'We do not track visits, pages, clicks or keystrokes, and we do not set advertising cookies.',
				'Exports are rendered and encoded locally and downloaded as MP4 files; no render queue processes them elsewhere.'
			]
		},
		{
			heading: 'Media and project files',
			body: 'The media you import is read with the File API and kept in your browser. Previews use object URLs that your browser creates and revokes. When you download a project file (.viko) or export a video, that file is produced locally and saved through your browser download flow.'
		},
		{
			heading: 'Clearing your data',
			body: 'All stored data lives inside your browser profile. You can remove it at any time by clearing site data for the Viko domain in your browser settings, by using your browser private mode, or by creating a new project from the editor. The "Clear all data" path in the editor wipes the project, versions and media stores in one transaction.'
		},
		{
			heading: 'Links to other sites',
			body: 'The website links to GitHub (the Pimatis organization and the Viko repository) and to font CDNs that serve typefaces. Those sites have their own privacy policies, and this policy does not cover them.'
		},
		{
			heading: 'Changes to this policy',
			body: 'If this policy changes, the "Last updated" date above will be revised. Because the project is open source, every change to the app itself is visible in the public repository history.'
		}
	]}
/>
