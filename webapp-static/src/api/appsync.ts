/**
 * AppSync GraphQL client using Amplify API + Cognito auth.
 * Operations match schema: getProject, getTeam, listProjectsByTeam, createProject, generateComponentViaAI.
 */
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser } from 'aws-amplify/auth';

const client = generateClient();

export type Project = {
  id: string;
  name: string;
  description?: string | null;
  teamId: string;
  ownerId: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type Team = {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type CreateProjectInput = {
  id: string;
  teamId: string;
  ownerId: string;
  name: string;
  description?: string | null;
};

const GetProject = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) {
      id
      name
      description
      teamId
      ownerId
      createdAt
      updatedAt
    }
  }
`;

const GetTeam = /* GraphQL */ `
  query GetTeam($id: ID!) {
    getTeam(id: $id) {
      id
      name
      description
      createdAt
      updatedAt
    }
  }
`;

const ListProjectsByTeam = /* GraphQL */ `
  query ListProjectsByTeam($teamId: ID!) {
    listProjectsByTeam(teamId: $teamId) {
      id
      name
      description
      teamId
      ownerId
      createdAt
      updatedAt
    }
  }
`;

const CreateProject = /* GraphQL */ `
  mutation CreateProject($input: CreateProjectInput!) {
    createProject(input: $input) {
      id
      name
      description
      teamId
      ownerId
      createdAt
      updatedAt
    }
  }
`;

const GenerateComponentViaAI = /* GraphQL */ `
  mutation GenerateComponentViaAI($projectId: ID!, $prompt: String!) {
    generateComponentViaAI(projectId: $projectId, prompt: $prompt)
  }
`;

export async function getProject(id: string): Promise<Project | null> {
  const result = await client.graphql({
    query: GetProject,
    variables: { id },
  });
  return (result as { data: { getProject: Project | null } }).data.getProject;
}

export async function getTeam(id: string): Promise<Team | null> {
  const result = await client.graphql({
    query: GetTeam,
    variables: { id },
  });
  return (result as { data: { getTeam: Team | null } }).data.getTeam;
}

export async function listProjectsByTeam(teamId: string): Promise<Project[]> {
  const result = await client.graphql({
    query: ListProjectsByTeam,
    variables: { teamId },
  });
  return (result as { data: { listProjectsByTeam: Project[] } }).data.listProjectsByTeam ?? [];
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const result = await client.graphql({
    query: CreateProject,
    variables: { input },
  });
  const project = (result as { data: { createProject: Project } }).data.createProject;
  if (!project) throw new Error('createProject returned null');
  return project;
}

export async function generateComponentViaAI(projectId: string, prompt: string): Promise<string> {
  const result = await client.graphql({
    query: GenerateComponentViaAI,
    variables: { projectId, prompt },
  });
  const text = (result as { data: { generateComponentViaAI: string } }).data.generateComponentViaAI;
  if (text == null) throw new Error('generateComponentViaAI returned null');
  return text;
}

export async function getCurrentUserId(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    return user?.userId ?? null;
  } catch {
    return null;
  }
}
