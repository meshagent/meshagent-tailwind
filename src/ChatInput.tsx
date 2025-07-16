import * as React from "react";
import { v4 as uuidV4 } from "uuid";
import { ChatMessage } from "@meshagent/meshagent-react";

import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { FileUploader } from "./FileUploader";

interface ChatInputProps {
  onSubmit: (message: ChatMessage) => void;
  onFilesSelected: (files: File[]) => void;
}

export function ChatInput({ onSubmit, onFilesSelected }: ChatInputProps) {
  const [value, setValue] = React.useState("");

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    onSubmit(new ChatMessage({
        id: uuidV4(),
        text: trimmed,
    }));

    setValue("");
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t p-3 flex gap-3">
      <FileUploader onFilesSelected={onFilesSelected} />

      <Textarea
        placeholder="Type a message and press Ctrl+Enter…"
        className="flex-1 resize-none h-20"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onKeyDown={onKeyDown} />

      <Button onClick={handleSend} disabled={!value.trim()}>Send</Button>
    </div>
  );
}
