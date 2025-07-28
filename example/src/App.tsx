import { useState, useEffect, useCallback } from 'react';
import { ProjectConfigForm, ProjectConfigFormValues } from './ProjectConfigForm';
import { ChatApp } from './Chat.tsx';

export default function Main() {
  const [config, setConfig] = useState<ProjectConfigFormValues | null>(null);

  useEffect(() => {
      const storedConfig = sessionStorage.getItem('projectConfig');

      if (storedConfig) {
          setConfig(ProjectConfigFormValues.fromJSON(storedConfig));
      }
  }, []);

  const setConfigHandler = useCallback((data: ProjectConfigFormValues) => {
        setConfig(data);
        sessionStorage.setItem('projectConfig', data.toJSON());
  }, []);

  const clearConfigHandler = useCallback(() => {
        setConfig(null);
        sessionStorage.removeItem('projectConfig');
    }, []);

  return (
    <div className="h-full flex flex-col">
        <nav className="flex items-center flex-0 p-4 bg-white shadow mb-6 gap-4">
        <h1 className="flex-1 text-2xl font-bold">Meshagent Example</h1>
        {config && (
          <span className="text-sm text-gray-600">
            Room: {config.roomName}
          </span>
        )}
        {config && (
          <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600" onClick={clearConfigHandler}>Change</button>
        )}
      </nav>

      <div className="flex-1 min-h-0 flex flex-col">
        {config ? (<ChatApp config={config} />) : (<ProjectConfigForm onSubmit={setConfigHandler} />)}
      </div>
    </div>
  );
}
