export type TextStyle = {
	fontFamily:
		'Inter Variable' | 'Montserrat Variable' | 'Bebas Neue' | 'Playfair Display' | 'Space Grotesk';
	fontSize: number;
	fontWeight: number;
	color: string;
	backgroundColor: string;
	textAlign: 'left' | 'center' | 'right';
	textTransform: 'none' | 'uppercase';
};

export type TextPreset = {
	id: string;
	name: string;
	kind: 'text';
	category: string;
	textStyle: TextStyle;
};

export const TEXT_PRESETS: TextPreset[] = [
	{
		id: 'text-clean-title',
		name: 'Clean Title',
		kind: 'text',
		category: 'Title',
		textStyle: {
			fontFamily: 'Inter Variable',
			fontSize: 48,
			fontWeight: 700,
			color: '#ffffff',
			backgroundColor: 'transparent',
			textAlign: 'center',
			textTransform: 'none'
		}
	},
	{
		id: 'text-impact',
		name: 'Impact',
		kind: 'text',
		category: 'Social',
		textStyle: {
			fontFamily: 'Bebas Neue',
			fontSize: 64,
			fontWeight: 400,
			color: '#ffffff',
			backgroundColor: '#000000',
			textAlign: 'center',
			textTransform: 'uppercase'
		}
	},
	{
		id: 'text-editorial',
		name: 'Editorial',
		kind: 'text',
		category: 'Title',
		textStyle: {
			fontFamily: 'Playfair Display',
			fontSize: 54,
			fontWeight: 700,
			color: '#ffffff',
			backgroundColor: 'transparent',
			textAlign: 'center',
			textTransform: 'none'
		}
	},
	{
		id: 'text-modern',
		name: 'Modern',
		kind: 'text',
		category: 'Title',
		textStyle: {
			fontFamily: 'Montserrat Variable',
			fontSize: 46,
			fontWeight: 600,
			color: '#ffffff',
			backgroundColor: 'transparent',
			textAlign: 'center',
			textTransform: 'uppercase'
		}
	},
	{
		id: 'text-tech',
		name: 'Tech',
		kind: 'text',
		category: 'Lower Third',
		textStyle: {
			fontFamily: 'Space Grotesk',
			fontSize: 36,
			fontWeight: 600,
			color: '#ffffff',
			backgroundColor: '#111111cc',
			textAlign: 'left',
			textTransform: 'none'
		}
	}
];
