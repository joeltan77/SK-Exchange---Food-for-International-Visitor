import React from 'react';

interface AriaLiveAnnouncerProps {
  announcement: string;
}

export const AriaLiveAnnouncer: React.FC<AriaLiveAnnouncerProps> = ({ announcement }) => {
  return (
    <div
      id="live-announcer"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </div>
  );
};
