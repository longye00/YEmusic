import React, { useMemo, useRef, useState } from 'react';
import { DEFAULT_CAPPELLA_TUNING, DEFAULT_CLASSIC_TUNING, DEFAULT_CLADDAGH_TUNING, DEFAULT_DIORAMA_TUNING, DEFAULT_FUME_TUNING, DEFAULT_PARTITA_TUNING, DEFAULT_TILT_TUNING, DIORAMA_PARTICLE_DENSITY_MAX, DIORAMA_PARTICLE_DENSITY_MIN, DIORAMA_PARTICLE_GLOW_INTENSITY_MAX, DIORAMA_PARTICLE_GLOW_INTENSITY_MIN, DIORAMA_PARTICLE_SIZE_MAX, DIORAMA_PARTICLE_SIZE_MIN, type CappellaTuning, type ClassicTuning, type CladdaghTuning, type DioramaTuning, type FumeTuning, type PartitaTuning, type TiltColorScheme, type TiltTuning } from '../../types';
import { colorWithAlpha } from './colorMix';
import { type VisualizerSettingsPanelProps } from './definition';
import { DioramaGeometrySettings } from './diorama/DioramaGeometrySettings';
import { DioramaBackgroundParticleSettings } from './diorama/DioramaBackgroundParticleSettings';
import { DioramaEffectSettings } from './diorama/DioramaEffectSettings';
import { DioramaSettingsToggle } from './diorama/DioramaSettingsToggle';
import { resolveDioramaMoteCircumference, resolveDioramaMoteRadial } from './diorama/dioramaMoteField';
import VisualizerPresetGroup, { type VisualizerPresetOption } from './VisualizerPresetGroup';

// src/components/visualizer/settingsPanels.tsx
// Mode-owned preview settings panels used by discoverable visualizer entries.
type PresetOption<T> = VisualizerPresetOption<T>;
const PresetGroup = VisualizerPresetGroup;

const clampPartitaStagger = (value: number) => Math.min(180, Math.max(0, value));
const clampClassicBreathingFloatMultiplier = (value: number) => Math.min(2, Math.max(0, value));
const clampClassicWordSpacing = (value: number) => Math.min(2, Math.max(0, value));
const clampCladdaghFocusScaleRatio = (val: number) => Math.min(1.5, Math.max(0.0, val));
const clampCladdaghRadiusScale = (val: number) => Math.min(1.5, Math.max(0.5, val));
const clampCladdaghEllipseTiltDeg = (val: number) => Math.min(60, Math.max(0, val));

// YEmusic modification (2026): derived from Folia's settingsPanels.tsx. Only the Diorama and
// Claddagh panels (the two visualizers from v0.5.0+ whose panels live in this file) are kept; the
// panels of the older visualizers (classic, partita, fume, cappella, tilt) are not vendored.

const clampDioramaCameraSpeed = (value: number) => Math.min(1.85, Math.max(0.55, value));
const clampDioramaMotionAmount = (value: number) => Math.min(1.6, Math.max(0.4, value));
const clampDioramaAudioReactivity = (value: number) => Math.min(1.5, Math.max(0, value));

export const DioramaSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
    dioramaTuning = DEFAULT_DIORAMA_TUNING,
    onDioramaTuningChange,
}) => {
    const resolvedTuning: DioramaTuning = {
        cameraSpeed: clampDioramaCameraSpeed(dioramaTuning.cameraSpeed ?? DEFAULT_DIORAMA_TUNING.cameraSpeed),
        motionAmount: clampDioramaMotionAmount(dioramaTuning.motionAmount ?? DEFAULT_DIORAMA_TUNING.motionAmount),
        audioReactivity: clampDioramaAudioReactivity(dioramaTuning.audioReactivity ?? DEFAULT_DIORAMA_TUNING.audioReactivity),
        geometryVisibility: {
            ...DEFAULT_DIORAMA_TUNING.geometryVisibility,
            ...dioramaTuning.geometryVisibility,
        },
        particleDensity: Math.round(Math.min(
            DIORAMA_PARTICLE_DENSITY_MAX,
            Math.max(DIORAMA_PARTICLE_DENSITY_MIN, dioramaTuning.particleDensity ?? DEFAULT_DIORAMA_TUNING.particleDensity),
        )),
        particleScale: Math.min(
            DIORAMA_PARTICLE_SIZE_MAX,
            Math.max(DIORAMA_PARTICLE_SIZE_MIN, dioramaTuning.particleScale ?? DEFAULT_DIORAMA_TUNING.particleScale),
        ),
        particleGlowEnabled: dioramaTuning.particleGlowEnabled ?? DEFAULT_DIORAMA_TUNING.particleGlowEnabled,
        particleGlowIntensity: Math.min(
            DIORAMA_PARTICLE_GLOW_INTENSITY_MAX,
            Math.max(
                DIORAMA_PARTICLE_GLOW_INTENSITY_MIN,
                dioramaTuning.particleGlowIntensity ?? DEFAULT_DIORAMA_TUNING.particleGlowIntensity,
            ),
        ),
        showParticles: dioramaTuning.showParticles ?? DEFAULT_DIORAMA_TUNING.showParticles,
        backgroundParticleCircumference: resolveDioramaMoteCircumference(
            dioramaTuning.backgroundParticleCircumference ?? DEFAULT_DIORAMA_TUNING.backgroundParticleCircumference,
        ),
        backgroundParticleRadial: resolveDioramaMoteRadial(
            dioramaTuning.backgroundParticleRadial ?? DEFAULT_DIORAMA_TUNING.backgroundParticleRadial,
        ),
        glowEnabled: dioramaTuning.glowEnabled ?? DEFAULT_DIORAMA_TUNING.glowEnabled,
        glowIntensity: Math.min(1.5, Math.max(0.1, dioramaTuning.glowIntensity ?? DEFAULT_DIORAMA_TUNING.glowIntensity)),
        soulEnabled: dioramaTuning.soulEnabled ?? DEFAULT_DIORAMA_TUNING.soulEnabled,
        soulIntensity: Math.min(1.5, Math.max(0.1, dioramaTuning.soulIntensity ?? DEFAULT_DIORAMA_TUNING.soulIntensity)),
        soulActiveEnabled: dioramaTuning.soulActiveEnabled ?? DEFAULT_DIORAMA_TUNING.soulActiveEnabled,
        gradientEnabled: dioramaTuning.gradientEnabled ?? DEFAULT_DIORAMA_TUNING.gradientEnabled,
        gradientIntensity: Math.min(1.5, Math.max(0.1, dioramaTuning.gradientIntensity ?? DEFAULT_DIORAMA_TUNING.gradientIntensity)),
        keywordColoringEnabled: dioramaTuning.keywordColoringEnabled ?? DEFAULT_DIORAMA_TUNING.keywordColoringEnabled,
    };

    const handleDioramaTuningChange = (patch: Partial<DioramaTuning>) => {
        onDioramaTuningChange?.(patch);
    };

    return (
        <div
            className="rounded-[24px] border border-white/10 p-4 space-y-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div>
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.dioramaSettings')}
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.dioramaCameraSpeed')}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedTuning.cameraSpeed.toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="0.55"
                    max="1.85"
                    step="0.05"
                    value={resolvedTuning.cameraSpeed}
                    onChange={(event) => handleDioramaTuningChange({ cameraSpeed: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.dioramaMotionAmount')}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedTuning.motionAmount.toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="0.4"
                    max="1.6"
                    step="0.05"
                    value={resolvedTuning.motionAmount}
                    onChange={(event) => handleDioramaTuningChange({ motionAmount: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.dioramaAudioReactivity')}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {Math.round(resolvedTuning.audioReactivity * 100)}%
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={resolvedTuning.audioReactivity}
                    onChange={(event) => handleDioramaTuningChange({ audioReactivity: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            {/* Three independent, stackable follow-sing effects - each an on/off toggle plus strength
                tiers (slider only under 自定义). Their rendering paths are fully separate in
                DioramaScene, so enabling one never stands in for another. */}
            <DioramaEffectSettings
                label={t('options.dioramaGlowEffect')}
                enabled={resolvedTuning.glowEnabled}
                intensity={resolvedTuning.glowIntensity}
                onEnabledChange={(next) => handleDioramaTuningChange({ glowEnabled: next })}
                onIntensityChange={(next) => handleDioramaTuningChange({ glowIntensity: next })}
                t={t}
                isDaylight={isDaylight}
                theme={theme}
                rangeInputClass={rangeInputClass}
                onSliderPointerDown={onSliderPointerDown}
                onSliderCommit={onSliderCommit}
            />
            {/* 灵魂出窍跟唱, with 当前字漂移 as its nested child (same underlying effect, scoped to the word
                being sung) rendered inside its expanded panel - not a standalone effect in the list. */}
            <DioramaEffectSettings
                label={t('options.dioramaSoulEffect')}
                enabled={resolvedTuning.soulEnabled}
                intensity={resolvedTuning.soulIntensity}
                onEnabledChange={(next) => handleDioramaTuningChange({ soulEnabled: next })}
                onIntensityChange={(next) => handleDioramaTuningChange({ soulIntensity: next })}
                subEffect={{
                    label: t('options.dioramaSoulActiveEffect'),
                    enabled: resolvedTuning.soulActiveEnabled,
                    onEnabledChange: (next) => handleDioramaTuningChange({ soulActiveEnabled: next }),
                }}
                t={t}
                isDaylight={isDaylight}
                theme={theme}
                rangeInputClass={rangeInputClass}
                onSliderPointerDown={onSliderPointerDown}
                onSliderCommit={onSliderCommit}
            />
            <DioramaEffectSettings
                label={t('options.dioramaGradientEffect')}
                enabled={resolvedTuning.gradientEnabled}
                intensity={resolvedTuning.gradientIntensity}
                onEnabledChange={(next) => handleDioramaTuningChange({ gradientEnabled: next })}
                onIntensityChange={(next) => handleDioramaTuningChange({ gradientIntensity: next })}
                t={t}
                isDaylight={isDaylight}
                theme={theme}
                rangeInputClass={rangeInputClass}
                onSliderPointerDown={onSliderPointerDown}
                onSliderCommit={onSliderCommit}
            />

            {/* 关键字着色: a plain on/off - the colours themselves are the theme's 关键词 list, not a
                strength. Independent of the follow-sing effects above: it sets the colour a unit RESTS
                at, and they dye away from it and settle back onto it. */}
            <div
                className="flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-3"
                style={{
                    borderColor: colorWithAlpha(theme.secondaryColor, isDaylight ? 0.17 : 0.14),
                    backgroundColor: colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34),
                }}
            >
                <span className="min-w-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.dioramaKeywordColoring')}
                </span>
                <DioramaSettingsToggle
                    checked={resolvedTuning.keywordColoringEnabled}
                    label={t('options.dioramaKeywordColoring')}
                    onChange={(next) => handleDioramaTuningChange({ keywordColoringEnabled: next })}
                    theme={theme}
                    isDaylight={isDaylight}
                />
            </div>

            <DioramaGeometrySettings
                t={t}
                theme={theme}
                isDaylight={isDaylight}
                value={resolvedTuning.geometryVisibility}
                onChange={(geometryVisibility) => handleDioramaTuningChange({ geometryVisibility })}
                density={resolvedTuning.particleDensity}
                onDensityChange={(particleDensity) => handleDioramaTuningChange({ particleDensity })}
                particleScale={resolvedTuning.particleScale}
                onParticleScaleChange={(particleScale) => handleDioramaTuningChange({ particleScale })}
                glowEnabled={resolvedTuning.particleGlowEnabled}
                onGlowEnabledChange={(particleGlowEnabled) => handleDioramaTuningChange({ particleGlowEnabled })}
                glowIntensity={resolvedTuning.particleGlowIntensity}
                onGlowIntensityChange={(particleGlowIntensity) => handleDioramaTuningChange({ particleGlowIntensity })}
                rangeInputClass={rangeInputClass}
                onSliderPointerDown={onSliderPointerDown}
                onSliderCommit={onSliderCommit}
            />

            <DioramaBackgroundParticleSettings
                label={t('options.dioramaShowParticles')}
                enabled={resolvedTuning.showParticles}
                circumference={resolvedTuning.backgroundParticleCircumference}
                radial={resolvedTuning.backgroundParticleRadial}
                onEnabledChange={(next) => handleDioramaTuningChange({ showParticles: next })}
                onCircumferenceChange={(backgroundParticleCircumference) => handleDioramaTuningChange({ backgroundParticleCircumference })}
                onRadialChange={(backgroundParticleRadial) => handleDioramaTuningChange({ backgroundParticleRadial })}
                t={t}
                isDaylight={isDaylight}
                theme={theme}
                rangeInputClass={rangeInputClass}
                onSliderPointerDown={onSliderPointerDown}
                onSliderCommit={onSliderCommit}
            />
        </div>
    );
};

const clampCladdaghLetterSpacingOffset = (val: number) => Math.min(20, Math.max(-5, val));

export const CladdaghSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
    claddaghTuning = DEFAULT_CLADDAGH_TUNING,
    onCladdaghTuningChange,
}) => {
    const resolvedTuning: CladdaghTuning = {
        focusScaleRatio: clampCladdaghFocusScaleRatio(claddaghTuning.focusScaleRatio ?? DEFAULT_CLADDAGH_TUNING.focusScaleRatio),
        radiusScale: clampCladdaghRadiusScale(claddaghTuning.radiusScale ?? DEFAULT_CLADDAGH_TUNING.radiusScale),
        ellipseTiltDeg: clampCladdaghEllipseTiltDeg(claddaghTuning.ellipseTiltDeg ?? DEFAULT_CLADDAGH_TUNING.ellipseTiltDeg),
        showAxisLine: claddaghTuning.showAxisLine ?? DEFAULT_CLADDAGH_TUNING.showAxisLine,
        letterSpacingOffset: clampCladdaghLetterSpacingOffset(claddaghTuning.letterSpacingOffset ?? DEFAULT_CLADDAGH_TUNING.letterSpacingOffset),
    };

    const axisLineOptions: PresetOption<boolean>[] = useMemo(() => ([
        { value: true, label: t('options.partitaGuideLinesOn') },
        { value: false, label: t('options.partitaGuideLinesOff') },
    ]), [t]);

    return (
        <div
            className="rounded-[24px] border border-white/10 p-4 space-y-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.claddaghSettings') }
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.claddaghSettingsDesc')}
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.claddaghFocusScaleRatio') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {(resolvedTuning.focusScaleRatio + 1.0).toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="0.0"
                    max="1.5"
                    step="0.05"
                    value={resolvedTuning.focusScaleRatio}
                    onChange={(event) => onCladdaghTuningChange?.({ focusScaleRatio: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.claddaghRadiusScale') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedTuning.radiusScale.toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="0.5"
                    max="1.5"
                    step="0.05"
                    value={resolvedTuning.radiusScale}
                    onChange={(event) => onCladdaghTuningChange?.({ radiusScale: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.claddaghEllipseTiltDeg') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedTuning.ellipseTiltDeg}°
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="60"
                    step="1"
                    value={resolvedTuning.ellipseTiltDeg}
                    onChange={(event) => onCladdaghTuningChange?.({ ellipseTiltDeg: parseInt(event.target.value, 10) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <PresetGroup
                label={t('options.claddaghShowAxisLine')}
                value={resolvedTuning.showAxisLine}
                options={axisLineOptions}
                onChange={(next) => onCladdaghTuningChange?.({ showAxisLine: next })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.claddaghLetterSpacingOffset')}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedTuning.letterSpacingOffset > 0 ? '+' : ''}{resolvedTuning.letterSpacingOffset.toFixed(1)}px
                    </span>
                </div>
                <input
                    type="range"
                    min="-5"
                    max="20"
                    step="0.5"
                    value={resolvedTuning.letterSpacingOffset}
                    onChange={(event) => onCladdaghTuningChange?.({ letterSpacingOffset: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>
        </div>
    );
};
