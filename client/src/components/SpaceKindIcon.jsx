import { Shovel, Warehouse, Flower2, Trees, Layers, Sprout } from 'lucide-react';

const ICONS = { bed: Shovel, greenhouse: Warehouse, container: Flower2, food_forest: Trees, microgreen_rack: Layers, seed_starting: Sprout };

export function SpaceKindIcon({ kind, size = 18 }) {
  const Icon = ICONS[kind] ?? Sprout;
  return <Icon size={size} aria-hidden="true" />;
}
