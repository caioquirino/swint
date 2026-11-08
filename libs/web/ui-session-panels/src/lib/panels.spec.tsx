import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionBanner } from './connection-banner.js';
import { InstructionsPanel, RubricPanel } from './panels.js';
import { PanelBoundary } from './panel-boundary.js';
import { ParticipantList } from './participant-list.js';

describe('panels', () => {
  it('labels the rubric as interviewer-only', () => {
    render(<RubricPanel markdown="- scaling" />);
    expect(screen.getByText(/only interviewers can see this/i)).toBeInTheDocument();
    render(<InstructionsPanel markdown="# Go" />);
    expect(screen.getByRole('heading', { name: 'Go' })).toBeInTheDocument();
  });

  it('lists participants with role badges', () => {
    render(
      <ParticipantList
        participants={[
          { userId: 'sub-1', name: 'Ada', role: 'interviewer', color: '#1971c2', selectedElementIds: {} },
          { userId: 'candidate:s1', name: 'Bo', role: 'candidate', color: '#2f9e44', selectedElementIds: {} },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Ada');
    expect(items[0]).toHaveTextContent('Interviewer');
    expect(items[1]).toHaveTextContent('Candidate');
  });

  it.each([
    ['connecting', /connecting/i],
    ['reconnecting', /reconnecting/i],
    ['unreachable', /can.t reach/i],
  ] as const)('banner %s', (state, text) => {
    render(<ConnectionBanner state={state} />);
    expect(screen.getByRole('status')).toHaveTextContent(text);
  });

  it('renders nothing when connected', () => {
    const { container } = render(<ConnectionBanner state={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('isolates a crashing panel', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Boom = () => {
      throw new Error('boom');
    };
    render(
      <div>
        <PanelBoundary title="Notes"><Boom /></PanelBoundary>
        <p>still here</p>
      </div>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Notes failed to load');
    expect(screen.getByText('still here')).toBeInTheDocument();
  });
});
