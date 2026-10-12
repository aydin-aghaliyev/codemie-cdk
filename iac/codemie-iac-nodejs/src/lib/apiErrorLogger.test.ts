/*
 * Copyright © 2025 EPAM Systems, Inc. All Rights Reserved. All information contained herein is, and remains the
 * property of EPAM Systems, Inc. and/or its suppliers and is protected by international intellectual
 * property law. Dissemination of this information or reproduction of this material is strictly forbidden,
 * unless prior written permission is obtained from EPAM Systems, Inc
 */
import { logApiErrorDetails } from './apiErrorLogger';
import { logger } from './logger';

jest.mock('./logger');
const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('logApiErrorDetails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs status and response for an SDK ApiError shape (statusCode + response)', () => {
    const error = Object.assign(new Error('Bad request'), { statusCode: 400, response: { detail: 'bad' } });

    logApiErrorDetails(error);

    expect(mockedLogger.error).toHaveBeenCalledWith('     Bad request');
    expect(mockedLogger.error).toHaveBeenCalledWith('     Status: 400');
    expect(mockedLogger.error).toHaveBeenCalledWith(`     Data: ${JSON.stringify({ detail: 'bad' }, null, 2)}`);
    expect(mockedLogger.debug).toHaveBeenCalledWith('     Stack:', error.stack);
  });

  it('logs status and data for an Axios error shape (response.status/data)', () => {
    const error = Object.assign(new Error('Server error'), { response: { status: 500, data: { msg: 'boom' } } });

    logApiErrorDetails(error);

    expect(mockedLogger.error).toHaveBeenCalledWith('     Server error');
    expect(mockedLogger.error).toHaveBeenCalledWith('     Status: 500');
    expect(mockedLogger.error).toHaveBeenCalledWith(`     Data: ${JSON.stringify({ msg: 'boom' }, null, 2)}`);
  });

  it('logs only the message for a plain Error', () => {
    logApiErrorDetails(new Error('plain failure'));

    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith('     plain failure');
  });

  it('logs String(error) for a non-Error value', () => {
    logApiErrorDetails('something odd');

    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith('     something odd');
  });
});
