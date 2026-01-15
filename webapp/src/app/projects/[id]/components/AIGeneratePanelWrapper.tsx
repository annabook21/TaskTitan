'use client';

import { useSearchParams } from 'next/navigation';
import AIGeneratePanel from './AIGeneratePanel';

interface Props {
  projectId: string;
  hasDescription: boolean;
  cycleEnabled?: boolean;
  cycleName?: string;
}

export default function AIGeneratePanelWrapper({
  projectId,
  hasDescription,
  cycleEnabled = true,
  cycleName = 'Sprint',
}: Props) {
  const searchParams = useSearchParams();
  const autoOpen = searchParams.get('generateAI') === 'true';

  return (
    <AIGeneratePanel
      projectId={projectId}
      hasDescription={hasDescription}
      autoOpen={autoOpen}
      cycleEnabled={cycleEnabled}
      cycleName={cycleName}
    />
  );
}
