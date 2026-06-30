import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mock functions that we'll control in tests
const mockSend = vi.fn();
const mockMessagesCreate = vi.fn();
const mockLogInfo = vi.fn();

// Mock AWS SES with proper class syntax
vi.mock('@aws-sdk/client-ses', () => {
  return {
    SESClient: class MockSESClient {
      send = mockSend;
    },
    SendEmailCommand: class MockSendEmailCommand {
      constructor(public params: unknown) {}
    },
  };
});

// Mock Mailgun with proper class/function syntax
vi.mock('mailgun.js', () => {
  return {
    default: class MockMailgun {
      client() {
        return {
          messages: {
            create: mockMessagesCreate,
          },
        };
      }
    },
  };
});

vi.mock('form-data', () => {
  return {
    default: class MockFormData {},
  };
});

// Mock the pino logger
vi.mock('./logger', () => {
  return {
    default: {
      child: () => ({
        info: mockLogInfo,
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

describe('email module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('sendMagicLinkEmail', () => {
    it('should log via logger when EMAIL_PROVIDER is mock', async () => {
      process.env.EMAIL_PROVIDER = 'mock';

      const { sendMagicLinkEmail } = await import('./email');
      await sendMagicLinkEmail({
        to: 'test@example.com',
        magicLink: 'https://example.com/verify?token=abc123',
      });

      expect(mockLogInfo).toHaveBeenCalledWith(
        { to: 'test@example.com', type: 'magic_link' },
        'Mock email sent'
      );
      expect(mockSend).not.toHaveBeenCalled();
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('should use Mailgun when EMAIL_PROVIDER is mailgun', async () => {
      process.env.EMAIL_PROVIDER = 'mailgun';
      process.env.MAILGUN_API_KEY = 'test-api-key';
      process.env.MAILGUN_DOMAIN = 'mg.example.com';
      process.env.MAILGUN_FROM_EMAIL = 'noreply@example.com';

      mockMessagesCreate.mockResolvedValueOnce({ id: 'msg-123' });

      const { sendMagicLinkEmail } = await import('./email');
      await sendMagicLinkEmail({
        to: 'test@example.com',
        magicLink: 'https://example.com/verify?token=abc123',
      });

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        'mg.example.com',
        expect.objectContaining({
          from: 'noreply@example.com',
          to: ['test@example.com'],
          subject: 'Sign in to OpenGander',
          html: expect.stringContaining('Sign in to your account'),
          text: expect.stringContaining('Sign in to OpenGander'),
        })
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should use SES when EMAIL_PROVIDER is ses', async () => {
      process.env.EMAIL_PROVIDER = 'ses';
      process.env.SES_FROM_EMAIL = 'noreply@ses.example.com';

      mockSend.mockResolvedValueOnce({ MessageId: 'ses-msg-123' });

      const { sendMagicLinkEmail } = await import('./email');
      await sendMagicLinkEmail({
        to: 'test@example.com',
        magicLink: 'https://example.com/verify?token=abc123',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      // Verify the command was created with correct params
      const callArg = mockSend.mock.calls[0][0];
      expect(callArg.params).toMatchObject({
        Source: 'noreply@ses.example.com',
        Destination: { ToAddresses: ['test@example.com'] },
        Message: {
          Subject: { Data: 'Sign in to OpenGander', Charset: 'UTF-8' },
        },
      });
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('should default to mock when EMAIL_PROVIDER is not set', async () => {
      delete process.env.EMAIL_PROVIDER;

      const { sendMagicLinkEmail } = await import('./email');
      await sendMagicLinkEmail({
        to: 'test@example.com',
        magicLink: 'https://example.com/verify?token=abc123',
      });

      expect(mockLogInfo).toHaveBeenCalledWith(
        { to: 'test@example.com', type: 'magic_link' },
        'Mock email sent'
      );
      expect(mockSend).not.toHaveBeenCalled();
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });
  });

  describe('sendInviteEmail', () => {
    const inviteParams = {
      to: 'invitee@example.com',
      inviteLink: 'https://example.com/invite?token=xyz789',
      tenantName: 'Acme Corp',
      role: 'user',
      inviterEmail: 'admin@acme.com',
      expiresAt: new Date('2026-01-29T00:00:00Z'),
    };

    it('should log via logger when EMAIL_PROVIDER is mock', async () => {
      process.env.EMAIL_PROVIDER = 'mock';

      const { sendInviteEmail } = await import('./email');
      await sendInviteEmail(inviteParams);

      expect(mockLogInfo).toHaveBeenCalledWith(
        { to: 'invitee@example.com', type: 'invite', tenantName: 'Acme Corp', role: 'user' },
        'Mock email sent'
      );
      expect(mockSend).not.toHaveBeenCalled();
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('should use Mailgun when EMAIL_PROVIDER is mailgun', async () => {
      process.env.EMAIL_PROVIDER = 'mailgun';
      process.env.MAILGUN_API_KEY = 'test-api-key';
      process.env.MAILGUN_DOMAIN = 'mg.example.com';
      process.env.MAILGUN_FROM_EMAIL = 'noreply@example.com';

      mockMessagesCreate.mockResolvedValueOnce({ id: 'msg-456' });

      const { sendInviteEmail } = await import('./email');
      await sendInviteEmail(inviteParams);

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        'mg.example.com',
        expect.objectContaining({
          from: 'noreply@example.com',
          to: ['invitee@example.com'],
          subject: "You've been invited to Acme Corp on OpenGander",
          html: expect.stringContaining('admin@acme.com'),
          text: expect.stringContaining('Acme Corp'),
        })
      );
    });

    it('should use SES when EMAIL_PROVIDER is ses', async () => {
      process.env.EMAIL_PROVIDER = 'ses';
      process.env.SES_FROM_EMAIL = 'noreply@ses.example.com';

      mockSend.mockResolvedValueOnce({ MessageId: 'ses-msg-456' });

      const { sendInviteEmail } = await import('./email');
      await sendInviteEmail(inviteParams);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArg = mockSend.mock.calls[0][0];
      expect(callArg.params).toMatchObject({
        Source: 'noreply@ses.example.com',
        Destination: { ToAddresses: ['invitee@example.com'] },
        Message: {
          Subject: { Data: "You've been invited to Acme Corp on OpenGander", Charset: 'UTF-8' },
        },
      });
    });
  });

  describe('sendWaitlistNotification', () => {
    it('should log via logger when EMAIL_PROVIDER is mock', async () => {
      process.env.EMAIL_PROVIDER = 'mock';

      const { sendWaitlistNotification } = await import('./email');
      await sendWaitlistNotification({
        email: 'prospect@example.com',
        company: 'Startup Inc',
      });

      expect(mockLogInfo).toHaveBeenCalledWith(
        { email: 'prospect@example.com', company: 'Startup Inc', type: 'waitlist' },
        'Mock email sent'
      );
      expect(mockSend).not.toHaveBeenCalled();
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('should handle missing company in mock mode', async () => {
      process.env.EMAIL_PROVIDER = 'mock';

      const { sendWaitlistNotification } = await import('./email');
      await sendWaitlistNotification({
        email: 'prospect@example.com',
      });

      expect(mockLogInfo).toHaveBeenCalledWith(
        { email: 'prospect@example.com', company: 'Not provided', type: 'waitlist' },
        'Mock email sent'
      );
    });

    it('should use Mailgun when EMAIL_PROVIDER is mailgun', async () => {
      process.env.EMAIL_PROVIDER = 'mailgun';
      process.env.MAILGUN_API_KEY = 'test-api-key';
      process.env.MAILGUN_DOMAIN = 'mg.example.com';
      process.env.MAILGUN_FROM_EMAIL = 'noreply@example.com';
      process.env.WAITLIST_NOTIFY_EMAIL = 'sales@example.com';

      mockMessagesCreate.mockResolvedValueOnce({ id: 'msg-789' });

      const { sendWaitlistNotification } = await import('./email');
      await sendWaitlistNotification({
        email: 'prospect@example.com',
        company: 'Startup Inc',
      });

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        'mg.example.com',
        expect.objectContaining({
          from: 'noreply@example.com',
          to: ['sales@example.com'],
          subject: 'New Waitlist Signup: prospect@example.com',
          html: expect.stringContaining('Startup Inc'),
        })
      );
    });

    it('should use SES when EMAIL_PROVIDER is ses', async () => {
      process.env.EMAIL_PROVIDER = 'ses';
      process.env.SES_FROM_EMAIL = 'noreply@ses.example.com';
      process.env.WAITLIST_NOTIFY_EMAIL = 'sales@example.com';

      mockSend.mockResolvedValueOnce({ MessageId: 'ses-msg-789' });

      const { sendWaitlistNotification } = await import('./email');
      await sendWaitlistNotification({
        email: 'prospect@example.com',
        company: 'Startup Inc',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArg = mockSend.mock.calls[0][0];
      expect(callArg.params).toMatchObject({
        Source: 'noreply@ses.example.com',
        Destination: { ToAddresses: ['sales@example.com'] },
        Message: {
          Subject: { Data: 'New Waitlist Signup: prospect@example.com', Charset: 'UTF-8' },
        },
      });
    });
  });

  describe('error handling', () => {
    it('should propagate Mailgun errors', async () => {
      process.env.EMAIL_PROVIDER = 'mailgun';
      process.env.MAILGUN_API_KEY = 'test-api-key';
      process.env.MAILGUN_DOMAIN = 'mg.example.com';

      const mailgunError = new Error('Mailgun API error: Invalid API key');
      mockMessagesCreate.mockRejectedValueOnce(mailgunError);

      const { sendMagicLinkEmail } = await import('./email');

      await expect(
        sendMagicLinkEmail({
          to: 'test@example.com',
          magicLink: 'https://example.com/verify?token=abc123',
        })
      ).rejects.toThrow('Mailgun API error: Invalid API key');
    });

    it('should propagate SES errors', async () => {
      process.env.EMAIL_PROVIDER = 'ses';
      process.env.SES_FROM_EMAIL = 'noreply@ses.example.com';

      const sesError = new Error('SES error: Email address not verified');
      mockSend.mockRejectedValueOnce(sesError);

      const { sendMagicLinkEmail } = await import('./email');

      await expect(
        sendMagicLinkEmail({
          to: 'test@example.com',
          magicLink: 'https://example.com/verify?token=abc123',
        })
      ).rejects.toThrow('SES error: Email address not verified');
    });
  });
});
