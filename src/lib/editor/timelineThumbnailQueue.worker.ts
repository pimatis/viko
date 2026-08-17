type ThumbnailJob = {
	id: string;
	priority: 'hover' | 'filmstrip';
};

self.onmessage = ({ data }: MessageEvent<ThumbnailJob>) => {
	const delay = data.priority === 'hover' ? 0 : 16;
	setTimeout(() => self.postMessage(data), delay);
};
