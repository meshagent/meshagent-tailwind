import { useState } from 'react';
import { ProjectConfigForm, ProjectConfigFormValues } from './ProjectConfigForm';
import { ChatApp } from './Chat.tsx';

export default function Main() {
  const [config, setConfig] = useState<ProjectConfigFormValues | null>(null);

  return (
    <div className="h-full flex flex-col">
      <nav className="flex-0 p-4 bg-white shadow mb-6 ">
        <h1 className="text-2xl font-bold">Meshagent Chat Application</h1>
      </nav>

      <div className="flex-1 min-h-0 flex flex-col">
        {config ? (<ChatApp config={config} />) : (<ProjectConfigForm onSubmit={setConfig} />)}
      </div>
    </div>
  );
}
