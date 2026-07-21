import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

type TerminalPanelProps =
  | {
      mode?: 'text';
      lines: string[];
    }
  | {
      mode: 'ansi';
      chunks: string[];
    };

export function TerminalPanel(props: TerminalPanelProps) {
  if (props.mode === 'ansi') {
    return <AnsiTerminal chunks={props.chunks} />;
  }

  const { lines } = props;
  return (
    <pre className="terminal">
      {lines.length ? lines.slice(-300).join('\n') : '等待日志输出...'}
    </pre>
  );
}

function AnsiTerminal({ chunks }: { chunks: string[] }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const terminal = new Terminal({
      cols: 120,
      rows: 40,
      convertEol: true,
      cursorBlink: false,
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 14,
      theme: {
        background: '#10151c',
        foreground: '#d8f3dc'
      }
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    fitTerminal(terminal, fit);
    terminalRef.current = terminal;
    fitRef.current = fit;

    const onResize = () => fitTerminal(terminal, fit);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.reset();
    if (chunks.length) {
      terminal.write(chunks.slice(-800).join(''));
    } else {
      terminal.write('等待 QCE 控制台输出...');
    }
    if (fitRef.current) fitTerminal(terminal, fitRef.current);
  }, [chunks]);

  return <div className="terminal terminal-xterm" ref={hostRef} />;
}

function fitTerminal(terminal: Terminal, fit: FitAddon): void {
  fit.fit();
  if (terminal.cols < 140) {
    terminal.resize(140, Math.max(terminal.rows, 40));
  }
}
