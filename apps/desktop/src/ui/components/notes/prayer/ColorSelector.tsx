import React from 'react';
import { useI18n } from '../../../contexts/useI18n';

export type PrayerColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'gray' | 'none';

interface ColorSelectorProps {
  selectedColor?: PrayerColor;
  onChange: (color: PrayerColor) => void;
}

const COLORS: { value: PrayerColor; labelKey: string; bgClass: string; borderClass: string }[] = [
  { value: 'red', labelKey: 'prayerColor.red', bgClass: 'bg-red-500', borderClass: 'border-danger' },
  { value: 'orange', labelKey: 'prayerColor.orange', bgClass: 'bg-orange-500', borderClass: 'border-orange-600' },
  { value: 'yellow', labelKey: 'prayerColor.yellow', bgClass: 'bg-yellow-400', borderClass: 'border-yellow-500' },
  { value: 'green', labelKey: 'prayerColor.green', bgClass: 'bg-green-500', borderClass: 'border-green-600' },
  { value: 'blue', labelKey: 'prayerColor.blue', bgClass: 'bg-blue-500', borderClass: 'border-blue-600' },
  { value: 'purple', labelKey: 'prayerColor.purple', bgClass: 'bg-purple-500', borderClass: 'border-purple-600' },
  { value: 'pink', labelKey: 'prayerColor.pink', bgClass: 'bg-pink-500', borderClass: 'border-pink-600' },
  { value: 'gray', labelKey: 'prayerColor.gray', bgClass: 'bg-gray-500', borderClass: 'border-gray-600' },
  { value: 'none', labelKey: 'prayerColor.none', bgClass: 'bg-surface', borderClass: 'border-border-secondary' }
];

const ColorSelector: React.FC<ColorSelectorProps> = ({ selectedColor = 'none', onChange }) => {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-2">
      {COLORS.map((color) => (
        <button
          key={color.value}
          onClick={() => onChange(color.value)}
          className={`w-8 h-8 rounded-full border-2 transition-all ${color.bgClass} ${
            selectedColor === color.value ? `${color.borderClass} ring-2 ring-offset-2 ring-accent` : 'border-border-secondary'
          }`}
          title={t(color.labelKey)}
          aria-label={t(color.labelKey)}
        />
      ))}
    </div>
  );
};

export default ColorSelector;

/**
 * Get the background color class for a prayer color
 */
export function getColorClass(color?: PrayerColor): string {
  switch (color) {
    case 'red':
      return 'bg-red-500';
    case 'orange':
      return 'bg-orange-500';
    case 'yellow':
      return 'bg-yellow-400';
    case 'green':
      return 'bg-green-500';
    case 'blue':
      return 'bg-blue-500';
    case 'purple':
      return 'bg-purple-500';
    case 'pink':
      return 'bg-pink-500';
    case 'gray':
      return 'bg-gray-500';
    default:
      return 'bg-control';
  }
}

/**
 * Get the color badge component for a prayer
 */
export function ColorBadge({ color }: { color?: PrayerColor }) {
  if (!color || color === 'none') return null;
  return <div className={`w-3 h-3 rounded-full ${getColorClass(color)}`} />;
}
