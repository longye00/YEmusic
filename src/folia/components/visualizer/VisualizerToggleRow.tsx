import React from 'react';
import { type VisualizerSettingsPanelProps } from './definition';
import { DioramaSettingsToggle } from './diorama/DioramaSettingsToggle';

// src/components/visualizer/VisualizerToggleRow.tsx
// Boolean counterpart to VisualizerPresetGroup: a plain label + switch row that matches the
// slider rows, instead of a pair of 开启/关闭 pill buttons.
interface VisualizerToggleRowProps {
    label: string;
    value: boolean;
    onChange: (next: boolean) => void;
    isDaylight: boolean;
    theme: VisualizerSettingsPanelProps['theme'];
    disabled?: boolean;
}

const VisualizerToggleRow: React.FC<VisualizerToggleRowProps> = ({
    label,
    value,
    onChange,
    isDaylight,
    theme,
    disabled,
}) => (
    <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-sm" style={{ color: 'var(--text-primary)' }}>
            {label}
        </span>
        <DioramaSettingsToggle
            checked={value}
            label={label}
            onChange={onChange}
            theme={theme}
            isDaylight={isDaylight}
            disabled={disabled}
        />
    </div>
);

export default VisualizerToggleRow;
