import { MessageSquare, Image as ImageIcon } from 'lucide-react';

interface Props {
  sender: string;
  body: string;
  isImage?: boolean;
  onOpen: () => void;
}

export function ChatSnackbar({ sender, body, isImage, onOpen }: Props) {
  return (
    <div
      className="alert alert-info cursor-pointer py-0"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {isImage ? <ImageIcon size={14} /> : <MessageSquare size={14} />}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-xs font-semibold truncate">{sender}</div>
        <div className="text-[11px] text-subtle truncate">{body}</div>
      </div>
    </div>
  );
}
