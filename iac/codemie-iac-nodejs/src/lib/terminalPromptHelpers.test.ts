/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */

import * as readline from 'node:readline';
import { promptUser, confirmOverwrite } from './terminalPromptHelpers';

// Mock readline module
jest.mock('node:readline');

describe('terminalPromptHelpers', () => {
  let mockClose: jest.Mock;
  let mockQuestion: jest.Mock;

  beforeEach(() => {
    mockClose = jest.fn();
    mockQuestion = jest.fn();

    (readline.createInterface as jest.Mock).mockReturnValue({
      question: mockQuestion,
      close: mockClose,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('promptUser', () => {
    it('should return user input when provided', async () => {
      const userInput = 'my-answer';
      mockQuestion.mockImplementation((_question: string, callback: (answer: string) => void) => {
        callback(userInput);
      });

      const result = await promptUser('What is your name?');

      expect(result).toBe(userInput);
      expect(mockQuestion).toHaveBeenCalledWith('What is your name?: ', expect.any(Function));
      expect(mockClose).toHaveBeenCalled();
    });

    it('should return default value when user input is empty', async () => {
      const defaultValue = 'default-name';
      mockQuestion.mockImplementation((_question: string, callback: (answer: string) => void) => {
        callback('');
      });

      const result = await promptUser('What is your name?', defaultValue);

      expect(result).toBe(defaultValue);
      expect(mockQuestion).toHaveBeenCalledWith(`What is your name? (${defaultValue}): `, expect.any(Function));
      expect(mockClose).toHaveBeenCalled();
    });

    it('should trim whitespace from user input', async () => {
      const userInput = '  trimmed  ';
      mockQuestion.mockImplementation((_question: string, callback: (answer: string) => void) => {
        callback(userInput);
      });

      const result = await promptUser('What is your name?');

      expect(result).toBe('trimmed');
    });

    it('should display default value in parentheses when provided', async () => {
      const defaultValue = 'default-value';
      mockQuestion.mockImplementation((_question: string, callback: (answer: string) => void) => {
        callback('');
      });

      await promptUser('Enter value', defaultValue);

      expect(mockQuestion).toHaveBeenCalledWith(`Enter value (${defaultValue}): `, expect.any(Function));
    });

    it('should return empty string when no input and no default value', async () => {
      mockQuestion.mockImplementation((_question: string, callback: (answer: string) => void) => {
        callback('');
      });

      const result = await promptUser('What is your name?');

      expect(result).toBe('');
    });

    it('should handle whitespace-only input with default value', async () => {
      const defaultValue = 'default';
      mockQuestion.mockImplementation((_question: string, callback: (answer: string) => void) => {
        callback('   ');
      });

      const result = await promptUser('Enter value', defaultValue);

      expect(result).toBe(defaultValue);
    });
  });

  describe('confirmOverwrite', () => {
    it('should return true when user answers "y"', async () => {
      mockQuestion.mockImplementation((_question: string, callback: (answer: string) => void) => {
        callback('y');
      });

      const result = await confirmOverwrite('config.json');

      expect(result).toBe(true);
      expect(mockQuestion).toHaveBeenCalledWith(
        `File 'config.json' already exists. Overwrite? (y/n): `,
        expect.any(Function)
      );
    });

    it('should return true when user answers "Y"', async () => {
      mockQuestion.mockImplementation((_question: string, callback: (answer: string) => void) => {
        callback('Y');
      });

      const result = await confirmOverwrite('test.yaml');

      expect(result).toBe(true);
    });

    it('should return false when user answers "n"', async () => {
      mockQuestion.mockImplementation((_question: string, callback: (answer: string) => void) => {
        callback('n');
      });

      const result = await confirmOverwrite('config.json');

      expect(result).toBe(false);
    });

    it('should return false when user answers "N"', async () => {
      mockQuestion.mockImplementation((_question: string, callback: (answer: string) => void) => {
        callback('N');
      });

      const result = await confirmOverwrite('test.yaml');

      expect(result).toBe(false);
    });

    it('should return false for any answer other than "y" or "Y"', async () => {
      mockQuestion.mockImplementation((_question: string, callback: (answer: string) => void) => {
        callback('maybe');
      });

      const result = await confirmOverwrite('config.json');

      expect(result).toBe(false);
    });

    it('should handle whitespace in user answer', async () => {
      mockQuestion.mockImplementation((_question: string, callback: (answer: string) => void) => {
        callback('  y  ');
      });

      const result = await confirmOverwrite('config.json');

      expect(result).toBe(true);
    });

    it('should close readline interface after getting answer', async () => {
      mockQuestion.mockImplementation((_question: string, callback: (answer: string) => void) => {
        callback('y');
      });

      await confirmOverwrite('config.json');

      expect(mockClose).toHaveBeenCalled();
    });

    it('should include filename in the prompt message', async () => {
      const filename = 'my-special-file.txt';
      mockQuestion.mockImplementation((_question: string, callback: (answer: string) => void) => {
        callback('n');
      });

      await confirmOverwrite(filename);

      expect(mockQuestion).toHaveBeenCalledWith(
        `File '${filename}' already exists. Overwrite? (y/n): `,
        expect.any(Function)
      );
    });
  });
});
