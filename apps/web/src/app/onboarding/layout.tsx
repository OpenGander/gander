'use client';

import { usePathname } from 'next/navigation';
import { CheckCircle2, Circle } from 'lucide-react';

const steps = [
  { id: 'checkout', label: 'Start Trial', path: '/onboarding/checkout' },
  { id: 'payment', label: 'Payment', path: '/onboarding/payment' },
  { id: 'domains', label: 'Add Domains', path: '/onboarding/domains' },
  { id: 'snippet', label: 'Get Snippet', path: '/onboarding/snippet' },
];

function getStepStatus(stepPath: string, currentPath: string) {
  const stepIndex = steps.findIndex((s) => s.path === stepPath);
  const currentIndex = steps.findIndex((s) => currentPath.startsWith(s.path));

  if (currentIndex === -1) return 'upcoming';
  if (stepIndex < currentIndex) return 'completed';
  if (stepIndex === currentIndex) return 'current';
  return 'upcoming';
}

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted">
      <div className="mx-auto max-w-3xl px-4 py-12">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold font-serif text-foreground">OpenGander</h1>
          <p className="mt-2 text-muted-foreground">Set up your analytics in minutes</p>
        </div>

        {/* Stepper */}
        <nav className="mb-12">
          <ol className="flex items-center justify-center space-x-4 md:space-x-8">
            {steps.map((step, index) => {
              const status = getStepStatus(step.path, pathname);

              return (
                <li key={step.id} className="flex items-center">
                  {index > 0 && (
                    <div
                      className={`mr-4 h-0.5 w-8 md:w-16 ${
                        status === 'completed' || status === 'current' ? 'bg-primary' : 'bg-border'
                      }`}
                    />
                  )}
                  <div className="flex items-center">
                    {status === 'completed' ? (
                      <CheckCircle2 className="h-6 w-6 text-primary" />
                    ) : status === 'current' ? (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-white">
                        {index + 1}
                      </div>
                    ) : (
                      <Circle className="h-6 w-6 text-muted-foreground/40" />
                    )}
                    <span
                      className={`ml-2 text-sm font-medium ${
                        status === 'current'
                          ? 'text-foreground'
                          : status === 'completed'
                            ? 'text-primary'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Content */}
        <main>{children}</main>

        {/* Dev reset link */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-8 text-center">
            <button
              onClick={() => {
                document.cookie = 'opengander_onboarding=; path=/; max-age=0';
                window.location.href = '/signin';
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Reset & Try Again (Dev)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
