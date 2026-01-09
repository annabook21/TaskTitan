'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import InviteMemberForm from './InviteMemberForm';

interface Props {
  teamId: string;
}

export default function InviteButton({ teamId }: Props) {
  const [showModal, setShowModal] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
      >
        + Invite
      </button>

      {showModal && (
        <InviteMemberForm
          teamId={teamId}
          onClose={() => setShowModal(false)}
          onSuccess={() => router.refresh()}
        />
      )}
    </>
  );
}
