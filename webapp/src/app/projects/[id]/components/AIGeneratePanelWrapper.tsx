'use client';

import { useSearchParams } from 'next/navigation';
import AIGeneratePanel from './AIGeneratePanel';

interface Props {
  projectId: string;
  hasDescription: boolean;
}

export default function AIGeneratePanelWrapper({ projectId, hasDescription }: Props) {
  const searchParams = useSearchParams();
  const autoOpen = searchParams.get('generateAI') === 'true';

  return <AIGeneratePanel projectId={projectId} hasDescription={hasDescription} autoOpen={autoOpen} />;
}
