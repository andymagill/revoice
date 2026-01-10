# shadCN/UI Integration Guide

## Overview

This project now uses **shadCN/UI** for Svelte, a component library built on top of Bits UI and Radix UI, styled with Tailwind CSS. All custom button and card elements have been replaced with shadCN components.

## What's Installed

- `shadcn-svelte`: Component library (v1.1.0)
- `bits-ui`: Headless UI components (v2.15.4)
- `lucide-svelte`: Icon library (v0.562.0)
- `clsx`: Utility for className manipulation (v2.1.1)
- `tailwind-merge`: Merge Tailwind CSS classes (v3.4.0)

## Project Structure

```
src/lib/
├── components/
│   ├── ui/                    # shadCN UI components
│   │   ├── button.svelte
│   │   ├── card.svelte
│   │   ├── card-header.svelte
│   │   ├── card-title.svelte
│   │   ├── card-description.svelte
│   │   ├── card-content.svelte
│   │   └── index.ts          # Export all components
│   ├── EqVisualizer.svelte    # Custom visualization component
│   ├── TranscriptionProvider.svelte
│   └── CompatibilityShield.svelte
├── utils.ts                   # Utility functions (cn for merging classes)
└── ...

components.json               # shadCN configuration
```

## Components Available

### Button

A reusable button component with multiple variants and sizes.

**Variants:** `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`
**Sizes:** `default`, `sm`, `lg`, `icon`

**Usage:**

```svelte
<script>
	import Button from '$lib/components/ui/button.svelte';
</script>

<Button variant="default" size="lg" onclick={handleClick}>Click me</Button>

<Button variant="destructive">Delete</Button>
<Button variant="ghost">Ghost Button</Button>
<Button variant="outline">Outline</Button>
```

### Card

Container component for grouping related content.

**Components:**

- `Card`: Main container
- `CardHeader`: Header section
- `CardTitle`: Title text
- `CardDescription`: Subtitle/description text
- `CardContent`: Main content area

**Usage:**

```svelte
<script>
	import Card from '$lib/components/ui/card.svelte';
	import CardHeader from '$lib/components/ui/card-header.svelte';
	import CardTitle from '$lib/components/ui/card-title.svelte';
	import CardDescription from '$lib/components/ui/card-description.svelte';
	import CardContent from '$lib/components/ui/card-content.svelte';
</script>

<Card>
	<CardHeader>
		<CardTitle>Card Title</CardTitle>
		<CardDescription>Card description goes here</CardDescription>
	</CardHeader>
	<CardContent>Your content here</CardContent>
</Card>
```

### Batch Import

You can import all UI components from the index file:

```svelte
<script>
	import {
		Button,
		Card,
		CardHeader,
		CardTitle,
		CardDescription,
		CardContent,
	} from '$lib/components/ui';
</script>
```

## Updated Files

### src/routes/+page.svelte

- Replaced custom `<button>` elements with `<Button>` component
- Replaced custom `<div>` containers with `<Card>` components
- Updated button styling to use shadCN variants

### src/routes/+layout.svelte

- Updated header and sidebar buttons to use `<Button>`
- Updated session cards and playback dock to use `<Card>`
- Updated all styling to use shadCN classes and variants

## Adding More Components

To add more shadCN components, you can:

1. **Manually create them** following the pattern in existing components
2. **Use the shadcn-svelte CLI** (if set up): `pnpm shadcn-svelte add [component-name]`

Popular components to consider adding:

- `Dialog`: Modal dialogs
- `Dropdown Menu`: Context menus
- `Input`: Form inputs
- `Select`: Dropdown selects
- `Checkbox`: Form checkboxes
- `Tabs`: Tabbed content
- `Badge`: Status badges
- `Alert`: Alert notifications

## Styling Notes

All components use **Tailwind CSS v4** for styling. The color scheme uses slate-based colors with blue accents. Some key classes:

- Text colors: `text-slate-900`, `text-slate-500`, `text-slate-600`
- Background colors: `bg-slate-50`, `bg-white`
- Border colors: `border-slate-200`, `border-slate-800`

## Build Status

✅ Build successful with shadCN components integrated.
⚠️ Minor CSS syntax warning (non-critical) in esbuild - does not affect functionality.

## Next Steps

Consider adding:

- Icon imports from `lucide-svelte` to replace emoji icons
- More specialized components as needed
- Custom theming if required
