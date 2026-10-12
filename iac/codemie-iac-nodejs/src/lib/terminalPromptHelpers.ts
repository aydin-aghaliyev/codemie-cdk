/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import * as readline from 'node:readline';

import { pauseSpinnerWhile } from './commandSpinner';

/**
 * Prompt user for input with optional default value
 * @param question - The question to ask the user
 * @param defaultValue - Optional default value shown in parentheses
 * @returns User input or default value
 */
export async function promptUser(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const displayQuestion = defaultValue ? `${question} (${defaultValue}): ` : `${question}: `;

  const answer = await pauseSpinnerWhile(
    () =>
      new Promise<string>((resolve) => {
        rl.question(displayQuestion, resolve);
      })
  );

  rl.close();

  const trimmedAnswer = answer.trim();
  return trimmedAnswer || defaultValue || '';
}

/**
 * Confirm if user wants to overwrite an existing file
 * @param filename - Name of the file to potentially overwrite
 * @returns true if user confirms overwrite, false otherwise
 */
export async function confirmOverwrite(filename: string): Promise<boolean> {
  const answer = await promptUser(`File '${filename}' already exists. Overwrite? (y/n)`);

  return answer.toLowerCase() === 'y';
}
