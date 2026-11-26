import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { useNotesZoomStore, NOTES_ZOOM_STORAGE_KEY, NOTES_ZOOM_MAX, NOTES_ZOOM_MIN } from './useNotesZoomStore';
import { useCtrlWheelNotesZoom } from '../hooks/useCtrlWheelNotesZoom';
import { NotesZoomControl, NotesZoomApplied, useNotesZoomStyle, useNotesZoomCounterStyle } from '../components/notes/NotesZoom';

vi.mock('../contexts/useI18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }));

beforeEach(() => {
  window.localStorage.clear();
  useNotesZoomStore.getState().reset();
  window.localStorage.clear();
});

describe('notes zoom', () => {
  it('steps, clamps and persists', () => {
    const s = useNotesZoomStore.getState();
    s.step(1);
    expect(useNotesZoomStore.getState().percent).toBe(110);
    expect(window.localStorage.getItem(NOTES_ZOOM_STORAGE_KEY)).toBe('110');
    s.setPercent(9999);
    expect(useNotesZoomStore.getState().percent).toBe(NOTES_ZOOM_MAX);
    s.setPercent(1);
    expect(useNotesZoomStore.getState().percent).toBe(NOTES_ZOOM_MIN);
  });

  it('control buttons zoom and reset', () => {
    render(<NotesZoomControl />);
    fireEvent.click(screen.getByTestId('notes-zoom-in'));
    fireEvent.click(screen.getByTestId('notes-zoom-in'));
    expect(screen.getByTestId('notes-zoom-reset')).toHaveTextContent('120%');
    fireEvent.click(screen.getByTestId('notes-zoom-out'));
    expect(screen.getByTestId('notes-zoom-reset')).toHaveTextContent('110%');
    fireEvent.click(screen.getByTestId('notes-zoom-reset'));
    expect(screen.getByTestId('notes-zoom-reset')).toHaveTextContent('100%');
  });

  it('the control is hidden inside a zoomed container and its toolbar is counter-zoomed', () => {
    useNotesZoomStore.getState().setPercent(200);
    const Probe = () => <div data-testid="c" style={useNotesZoomCounterStyle()} />;
    render(<NotesZoomApplied value={true}><NotesZoomControl /><Probe /></NotesZoomApplied>);
    expect(screen.queryByTestId('notes-zoom')).toBeNull();
    expect(screen.getByTestId('c').style.zoom).toBe('0.5');
  });

  it('Ctrl+wheel zooms and plain wheel does not', () => {
    const Box = () => { const r = useRef<HTMLDivElement>(null); useCtrlWheelNotesZoom(r); return <div ref={r} data-testid="box" />; };
    render(<Box />);
    fireEvent.wheel(screen.getByTestId('box'), { deltaY: -100 });
    expect(useNotesZoomStore.getState().percent).toBe(100);
    fireEvent.wheel(screen.getByTestId('box'), { deltaY: -100, ctrlKey: true });
    expect(useNotesZoomStore.getState().percent).toBe(110);
  });

  it('applies CSS zoom once, not again inside an already zoomed container', () => {
    useNotesZoomStore.getState().setPercent(150);
    const Probe = ({ id }: { id: string }) => <div data-testid={id} style={useNotesZoomStyle()} />;
    render(<><Probe id="a" /><NotesZoomApplied value={true}><Probe id="b" /></NotesZoomApplied></>);
    expect(screen.getByTestId('a').style.zoom).toBe('1.5');
    expect(screen.getByTestId('b').style.zoom ?? '').toBe('');
  });
});
