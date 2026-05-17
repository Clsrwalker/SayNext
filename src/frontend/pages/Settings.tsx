import { useRef, useState, useEffect } from 'react';
import Header from '../components/Header';
import SettingItem from '../ui/setting-item';
import ToggleSwitch from '../ui/toggle-switch';
import {
  fetchUserSettings,
  updateFrequency,
  updateOutputLanguage,
  updateTheme,
  resetCurrentSession,
  type FrequencyMode,
  type OutputLanguage,
} from '../api/settings.api';

interface SettingsProps {
  onBack: () => void;
  onOpenSampleReview: () => void;
  onOpenPrenotes: () => void;
  onOpenSceneProfiles: () => void;
  onOpenTranscriptExport: () => void;
  onOpenPersonalMemory: () => void;
  onOpenMemoryReview: () => void;
  onResetCurrentSession: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  userId: string;
}

const FREQUENCY_LABELS: Record<FrequencyMode, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const FREQUENCY_ORDER: FrequencyMode[] = ['low', 'medium', 'high'];

const OUTPUT_LANGUAGE_LABELS: Record<OutputLanguage, string> = {
  english: 'English',
  chinese: 'Chinese',
};

/**
 * Settings page - frequency toggle (LOW/MED/HIGH) + theme toggle
 */
function Settings({
  onBack,
  onOpenSampleReview,
  onOpenPrenotes,
  onOpenSceneProfiles,
  onOpenTranscriptExport,
  onOpenPersonalMemory,
  onOpenMemoryReview,
  onResetCurrentSession,
  isDarkMode,
  onToggleDarkMode,
  userId,
}: SettingsProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [frequency, setFrequency] = useState<FrequencyMode>('high');
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>('english');
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isResetting, setIsResetting] = useState(false);
  const [resetStatus, setResetStatus] = useState<'idle' | 'done' | 'error'>('idle');

  // Fetch user settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await fetchUserSettings(userId);
        setFrequency((settings.frequency as FrequencyMode) || 'high');
        setOutputLanguage(settings.outputLanguage === 'chinese' ? 'chinese' : 'english');
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setIsLoadingSettings(false);
      }
    };
    loadSettings();
  }, [userId]);

  // Cycle frequency: low -> medium -> high -> low
  const handleFrequencyCycle = async () => {
    const currentIndex = FREQUENCY_ORDER.indexOf(frequency);
    const nextIndex = (currentIndex + 1) % FREQUENCY_ORDER.length;
    const newFrequency = FREQUENCY_ORDER[nextIndex];
    setFrequency(newFrequency);

    try {
      await updateFrequency(userId, newFrequency);
      console.log('Frequency synced:', newFrequency);
    } catch (error) {
      console.error('Failed to update frequency:', error);
      setFrequency(frequency); // revert
    }
  };

  const handleOutputLanguageToggle = async () => {
    const newLanguage: OutputLanguage = outputLanguage === 'english' ? 'chinese' : 'english';
    setOutputLanguage(newLanguage);

    try {
      await updateOutputLanguage(userId, newLanguage);
      console.log('Output language synced:', newLanguage);
    } catch (error) {
      console.error('Failed to update output language:', error);
      setOutputLanguage(outputLanguage);
    }
  };

  // Handle theme toggle
  const handleThemeToggle = async () => {
    const newTheme = isDarkMode ? 'light' : 'dark';
    onToggleDarkMode();

    try {
      await updateTheme(userId, newTheme);
      console.log('Theme synced:', newTheme);
    } catch (error) {
      console.error('Failed to update theme:', error);
      onToggleDarkMode(); // revert
    }
  };

  const handleResetCurrentSession = async () => {
    if (isResetting) return;

    setIsResetting(true);
    setResetStatus('idle');
    try {
      await resetCurrentSession(userId);
      onResetCurrentSession();
      setResetStatus('done');
    } catch (error) {
      console.error('Failed to reset current session:', error);
      setResetStatus('error');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div
      className="h-screen flex flex-col"
      style={{
        backgroundColor: 'var(--background)',
        overscrollBehavior: 'none',
        touchAction: 'pan-y',
      }}
    >
      {/* Header */}
      <Header onSettingsClick={onBack} showBackArrow={true} />

      {/* Settings Content */}
      <div
        ref={scrollAreaRef}
        className="flex-1 px-[24px] pt-[48px] space-y-3 overflow-y-auto"
        style={{
          overscrollBehavior: 'none',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
        }}
      >
        {/* Theme Setting */}
        <SettingItem
          isFirstItem={true}
          isLastItem={false}
          settingItemName="Theme"
          customContent={
            <ToggleSwitch isOn={isDarkMode} onToggle={handleThemeToggle} label="Theme" />
          }
        />

        {/* Frequency Setting */}
        <SettingItem
          isFirstItem={false}
          isLastItem={false}
          settingItemName="Insight Frequency"
          customContent={
            <button
              onClick={handleFrequencyCycle}
              className="px-[12px] py-[6px] rounded-full text-[13px] font-semibold transition-all duration-300"
              style={{
                backgroundColor: 'var(--secondary-foreground)',
                color: 'var(--primary-foreground)',
              }}
            >
              {FREQUENCY_LABELS[frequency]}
            </button>
          }
        />

        <SettingItem
          isFirstItem={false}
          isLastItem={false}
          settingItemName="Reply Language"
          customContent={
            <button
              onClick={handleOutputLanguageToggle}
              className="px-[12px] py-[6px] rounded-full text-[13px] font-semibold transition-all duration-300"
              style={{
                backgroundColor: 'var(--secondary-foreground)',
                color: 'var(--primary-foreground)',
              }}
            >
              {OUTPUT_LANGUAGE_LABELS[outputLanguage]}
            </button>
          }
        />

        <SettingItem
          isFirstItem={false}
          isLastItem={false}
          settingItemName="Scene Profiles"
          customContent={
            <button
              onClick={onOpenSceneProfiles}
              className="px-[12px] py-[6px] rounded-full text-[13px] font-semibold transition-all duration-300"
              style={{
                backgroundColor: 'var(--secondary-foreground)',
                color: 'var(--primary-foreground)',
              }}
            >
              Manage
            </button>
          }
        />

        <SettingItem
          isFirstItem={false}
          isLastItem={false}
          settingItemName="Prenote"
          customContent={
            <button
              onClick={onOpenPrenotes}
              className="px-[12px] py-[6px] rounded-full text-[13px] font-semibold transition-all duration-300"
              style={{
                backgroundColor: 'var(--secondary-foreground)',
                color: 'var(--primary-foreground)',
              }}
            >
              Manage
            </button>
          }
        />

        <SettingItem
          isFirstItem={false}
          isLastItem={false}
          settingItemName="Personal Memory"
          customContent={
            <button
              onClick={onOpenPersonalMemory}
              className="px-[12px] py-[6px] rounded-full text-[13px] font-semibold transition-all duration-300"
              style={{
                backgroundColor: 'var(--secondary-foreground)',
                color: 'var(--primary-foreground)',
              }}
            >
              Manage
            </button>
          }
        />

        <SettingItem
          isFirstItem={false}
          isLastItem={false}
          settingItemName="Memory Review"
          customContent={
            <button
              onClick={onOpenMemoryReview}
              className="px-[12px] py-[6px] rounded-full text-[13px] font-semibold transition-all duration-300"
              style={{
                backgroundColor: 'var(--secondary-foreground)',
                color: 'var(--primary-foreground)',
              }}
            >
              Review
            </button>
          }
        />

        <SettingItem
          isFirstItem={false}
          isLastItem={false}
          settingItemName="Transcript Export"
          customContent={
            <button
              onClick={onOpenTranscriptExport}
              className="px-[12px] py-[6px] rounded-full text-[13px] font-semibold transition-all duration-300"
              style={{
                backgroundColor: 'var(--secondary-foreground)',
                color: 'var(--primary-foreground)',
              }}
            >
              Open
            </button>
          }
        />

        <SettingItem
          isFirstItem={false}
          isLastItem={false}
          settingItemName="Reset Current Session"
          customContent={
            <button
              onClick={handleResetCurrentSession}
              disabled={isResetting}
              className="px-[12px] py-[6px] rounded-full text-[13px] font-semibold transition-all duration-300 disabled:opacity-50"
              style={{
                backgroundColor: resetStatus === 'error' ? '#ef4444' : 'var(--secondary-foreground)',
                color: 'var(--primary-foreground)',
              }}
            >
              {isResetting ? 'Resetting' : resetStatus === 'done' ? 'Done' : resetStatus === 'error' ? 'Retry' : 'Reset'}
            </button>
          }
        />

        <SettingItem
          isFirstItem={false}
          isLastItem={true}
          settingItemName="Training Samples"
          customContent={
            <button
              onClick={onOpenSampleReview}
              className="px-[12px] py-[6px] rounded-full text-[13px] font-semibold transition-all duration-300"
              style={{
                backgroundColor: 'var(--secondary-foreground)',
                color: 'var(--primary-foreground)',
              }}
            >
              Review
            </button>
          }
        />

        {/* Version Info */}
        <div className="pt-8 text-center">
          <p className="text-[12px] text-muted-foreground">SayNext v1.0.0</p>
        </div>
      </div>
    </div>
  );
}

export default Settings;
