import type { ApplicationStatus } from '../api/applications';

const statusLabels: Record<ApplicationStatus, string> = {
  blocked: 'Blocked',
  in_progress: 'In progress',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  submitted: 'Submitted',
};

interface StatusBadgeProps {
  status: ApplicationStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`status-badge status-${status}`}>{statusLabels[status]}</span>;
}
