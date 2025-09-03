import React, { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ProjectConfigFormValuesProps {
    projectId: string;
    apiKey: string;
    secret: string;
    userName: string;
    roomName: string;
    apiUrl: string;
}

export class ProjectConfigFormValues {
    public projectId: string;
    public apiKey: string;
    public secret: string;
    public userName: string;
    public roomName: string;
    public apiUrl: string;

    constructor(
        projectId: string = '',
        apiKey: string = '',
        secret: string = '',
        userName: string = '',
        roomName: string = '',
        apiUrl: string = 'https://api.meshagent.com',
    ) {
        this.projectId = projectId;
        this.apiKey = apiKey;
        this.secret = secret;
        this.userName = userName;
        this.roomName = roomName;
        this.apiUrl = apiUrl;
    }

    toJSON(): string {
        return JSON.stringify({
            projectId: this.projectId,
            apiKey: this.apiKey,
            secret: this.secret,
            userName: this.userName,
            roomName: this.roomName,
            apiUrl: this.apiUrl,
        });
    }

    static fromJSON(json: string): ProjectConfigFormValues {
        const data = JSON.parse(json);
        return new ProjectConfigFormValues(
            data.projectId,
            data.apiKey,
            data.secret,
            data.userName,
            data.roomName,
            data.apiUrl,
        );
    }
}

export interface ProjectConfigFormProps {
    onSubmit: (data: ProjectConfigFormValues) => void;
}

export function ProjectConfigForm ({ onSubmit }: ProjectConfigFormProps): React.ReactElement {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProjectConfigFormValues>();

  const onSubmitHandler = useCallback((data: ProjectConfigFormValuesProps) => {
    const config = new ProjectConfigFormValues(
      data.projectId,
      data.apiKey,
      data.secret,
      data.userName,
      data.roomName,
      data.apiUrl,
    );

    onSubmit(config);
  }, [onSubmit]);

  return (
      <form onSubmit={handleSubmit(onSubmitHandler)} className="space-y-6 p-6 bg-white rounded-2xl shadow">
          <div className="space-y-2">
              <Label htmlFor="projectId">Project ID</Label>
              <Input id="projectId" placeholder="e.g. 1234567890" {...register("projectId", { required: "Project ID is required" })} />
              {errors.projectId && (<p className="mt-1 text-sm text-red-600">{errors.projectId.message}</p>)}
              <p className="mt-1 text-sm text-muted-foreground">
                  Retrieve your Project ID in  <strong>Meshagent Studio &rarr; API Keys Tab</strong>.
              </p>
          </div>

          <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input id="apiKey" placeholder="Enter your API Key" {...register("apiKey", { required: "API Key is required" })} />
              {errors.apiKey && (<p className="mt-1 text-sm text-red-600">{errors.apiKey.message}</p>)}
              <p className="mt-1 text-sm text-muted-foreground">
                  Retrieve your API Key in <strong>Meshagent Studio &rarr; API Keys Tab</strong>.
              </p>
          </div>

          <div className="space-y-2">
              <Label htmlFor="apiKey">Secret</Label>
              <Input id="secret" placeholder="Enter your secret key" {...register("secret", { required: "Secret is required" })} />
              {errors.apiKey && (<p className="mt-1 text-sm text-red-600">{errors.apiKey.message}</p>)}
              <p className="mt-1 text-sm text-muted-foreground">
                  Retrieve your API Key in <strong>Meshagent Studio &rarr; API Keys Tab</strong>.
              </p>
          </div>

          <div className="space-y-2">
              <Label htmlFor="userName">User Name</Label>
              <Input id="userName" placeholder="Your display name" {...register("userName", { required: "User Name is required" })} />
              {errors.userName && (
                  <p className="mt-1 text-sm text-red-600">{errors.userName.message}</p>
              )}
              <p className="mt-1 text-sm text-muted-foreground">
                  Enter your user name.
              </p>
          </div>

          <div className="space-y-2">
              <Label htmlFor="roomName">Room Name</Label>
              <Input id="roomName" placeholder="e.g. general-chat" {...register("roomName", { required: "Room Name is required" })} />
              {errors.roomName && (
                  <p className="mt-1 text-sm text-red-600">{errors.roomName.message}</p>
              )}
              <p className="mt-1 text-sm text-muted-foreground">
                  Specify the name of the room you want to join or create. View existing rooms under <strong>Meshagent Studio &rarr; Rooms &rarr; List</strong>.
              </p>
          </div>

          <div className="space-y-2">
              <Label htmlFor="apiUrl">API URL</Label>
              <Input id="apiUrl" defaultValue="https://api.meshagent.com" {...register("apiUrl", { required: "API URL is required" })} />
              {errors.apiUrl && (
                  <p className="mt-1 text-sm text-red-600">{errors.apiUrl.message}</p>
              )}
              <p className="mt-1 text-sm text-muted-foreground">
                  Specify the API URL for your Meshagent instance.
              </p>
          </div>

          <Button type="submit" className="w-full">Save Configuration</Button>
      </form>
  );
}

