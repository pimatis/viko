<script lang="ts">
	import { createReverseAudioPlayer, type ReverseAudioPlayer } from '$lib/audio/reverse';

	type Props = {
		src: string;
		sourceTime?: number;
		isPlaying?: boolean;
		rate?: number;
		volume?: number;
	};

	let { src, sourceTime = 0, isPlaying = false, rate = 1, volume = 1 }: Props = $props();

	let player = $state<ReverseAudioPlayer | null>(null);

	$effect(() => {
		let cancelled = false;
		void createReverseAudioPlayer(src).then((created) => {
			if (cancelled) {
				created?.destroy();
				return;
			}
			player = created;
		});
		return () => {
			cancelled = true;
			player?.destroy();
			player = null;
		};
	});

	$effect(() => {
		player?.update({ playing: isPlaying, sourceTime, rate, volume });
	});
</script>
