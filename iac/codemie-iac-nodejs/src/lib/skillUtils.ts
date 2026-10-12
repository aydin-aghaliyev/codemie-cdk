/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

/** Skill is owned by the project when its platform project matches the IaC project name. */
export function isProjectOwnedSkill(skill: { project: string }, projectName: string): boolean {
  return skill.project.trim().toLowerCase() === projectName.trim().toLowerCase();
}
