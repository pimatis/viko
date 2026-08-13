export type ShortcutSpec = {
	key: string;
	keys?: string[];
	ctrl?: boolean;
	meta?: boolean;
	ctrlOrMeta?: boolean;
	shift?: boolean;
	alt?: boolean;
};

export type ShortcutBinding = ShortcutSpec & {
	description?: string;
	ignoreWhenTyping?: boolean;
	enabled?: () => boolean;
	onKeyDown: (event: KeyboardEvent) => void;
	onKeyUp?: (event: KeyboardEvent) => void;
};
