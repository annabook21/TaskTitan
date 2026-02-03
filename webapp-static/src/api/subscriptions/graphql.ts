/**
 * GraphQL strings for component subscriptions.
 */

export const PublishComponentChange = /* GraphQL */ `
  mutation PublishComponentChange(
    $projectId: ID!
    $componentId: ID!
    $action: ComponentChangeAction!
    $component: ComponentInput
  ) {
    publishComponentChange(
      projectId: $projectId
      componentId: $componentId
      action: $action
      component: $component
    ) {
      projectId
      componentId
      action
    }
  }
`;

export const OnComponentChange = /* GraphQL */ `
  subscription OnComponentChange($projectId: ID!) {
    onComponentChange(projectId: $projectId) {
      projectId
      componentId
      action
      component {
        id
        name
        description
        type
        projectId
        parentId
        sprintId
        status
        priority
        estimatedHours
        actualHours
        dueDate
        owner
        tags
        acceptanceCriteria
        createdAt
        updatedAt
        startedAt
        hillPhase
      }
    }
  }
`;
