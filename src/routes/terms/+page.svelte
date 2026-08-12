<script lang="ts">
	import LegalPage from '../../components/home/LegalPage.svelte';
</script>

<svelte:head>
	<meta
		name="description"
		content="Viko terms of service: the editor is free software under the Apache 2.0 license, provided as-is without warranty."
	/>
	<meta property="og:type" content="website" />
	<meta property="og:title" content="Terms of service - Viko" />
	<meta
		property="og:description"
		content="Viko is free, open source software under the Apache 2.0 license, provided as-is without warranty."
	/>
	<meta property="og:url" content="https://github.com/pimatis/viko" />
	<meta name="robots" content="index, follow" />
</svelte:head>

<LegalPage
	title="Terms of service"
	updated="August 12, 2026"
	lead="Viko is free, open source software. These terms describe the conditions under which the app and its source code are made available to you."
	sections={[
		{
			heading: 'Open source license',
			body: 'The Viko source code is published on GitHub under the Apache License 2.0. You may use, modify and distribute the software under the terms of that license. The full license text is included in the repository and applies to any use of the code outside this website.'
		},
		{
			heading: 'Use of the app',
			body: 'The editor runs in your browser and works on the media you choose to import. You are responsible for the content you edit and for having the rights to use that content, including music, footage and images.'
		},
		{
			heading: 'Local processing and your data',
			body: 'Editing, preview and export happen locally on your device. Because no data is sent to our servers, we cannot retrieve, restore or inspect your projects, media or exports. Keep your own copies of anything you care about.'
		},
		{
			heading: 'No warranty',
			body: 'The software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and non-infringement, as stated in the Apache License 2.0. In no event shall the authors or copyright holders be liable for any claim, damages or other liability arising from the use of the software.'
		},
		{
			heading: 'Contributions',
			body: 'Contributions you submit to the Viko repository are accepted under the Apache License 2.0 terms, unless you state otherwise. Bug reports, feature requests and pull requests are welcome through the public GitHub repository.'
		},
		{
			heading: 'Contact',
			body: 'Questions about these terms can be raised through the GitHub repository issues page. Since the project is fully open source, the fastest path to a fix or an answer is usually a public issue or pull request.'
		}
	]}
/>
