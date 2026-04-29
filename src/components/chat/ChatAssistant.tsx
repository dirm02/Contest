import React, { useState, useRef, useEffect } from 'react';
import { useChat, type ChatMessage } from './ChatContext';

export default function ChatAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMockMode, setIsMockMode] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { messages, addMessage, pageContext } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isOpen]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = { role: 'user', content: input };
    addMessage(userMessage);
    setInput('');
    setIsLoading(true);

    if (isMockMode) {
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const mockResponse: ChatMessage = {
        role: 'assistant',
        content: `[MOCK MODE] I received your message: "${input}". 
        
Current Page Context: ${pageContext ? `Type: ${pageContext.type}, Name: ${pageContext.name || pageContext.recipientName || 'Unknown'}` : 'None'}.

This is a simulated response for testing the UI.`,
      };
      addMessage(mockResponse);
      setIsLoading(false);
      return;
    }

    try {
      const actualKey = import.meta.env.VITE_GEMINI_API_KEY;

      if (!actualKey) {
        throw new Error('Gemini API Key is not configured (VITE_GEMINI_API_KEY).');
      }

      const systemPrompt = `You are an AI assistant for AccountabilityMax.app, an investigative tool for tracking public funding, corporate risk, and government accountability.
      
Current Context:
${pageContext ? JSON.stringify(pageContext, null, 2) : 'No specific page context available.'}

Provide helpful, concise answers based on the context provided and the user's query.`;

      // Gemini format
      const history = messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts: [{ text: msg.content }]
      })).filter(msg => msg.role !== 'system');

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${actualKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            ...history,
            {
              role: 'user',
              parts: [{ text: input }]
            }
          ],
          system_instruction: {
            parts: [{ text: systemPrompt }]
          }
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to connect to Gemini');
      }

      const data = await response.json();
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.candidates[0].content.parts[0].text,
      };
      addMessage(assistantMessage);
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Error: ${error.message}. Please check your configuration.`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end">
      {isOpen && (
        <div className="mb-4 flex h-[500px] w-[380px] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-2xl transition-all animate-in slide-in-from-bottom-4">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-stone-50 p-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[var(--color-ink)]">Accountability Assistant</h3>
                <button 
                  onClick={() => setIsMockMode(!isMockMode)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition ${isMockMode ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-stone-200 text-stone-500 hover:bg-stone-300'}`}
                >
                  {isMockMode ? 'Mock' : 'Live'}
                </button>
              </div>
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-muted)]">
                {pageContext ? 'Contextual Analysis Active' : 'General Inquiry'}
              </p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-1 text-[var(--color-muted)] hover:bg-stone-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-3 rounded-full bg-[var(--color-accent)]/10 p-3 text-[var(--color-accent)]">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-[var(--color-ink)]">How can I help you today?</p>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Ask about risk signals, funding patterns, or entity details.
                </p>
              </div>
            )}
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-[var(--color-accent)] text-white'
                      : msg.role === 'system'
                      ? 'bg-red-50 text-red-700 border border-red-100'
                      : 'bg-stone-100 text-[var(--color-ink)]'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl bg-stone-100 px-4 py-2 text-sm text-[var(--color-ink)]">
                  <span className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:0.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:0.4s]" />
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSend} className="border-t border-[var(--color-border)] p-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question..."
                className="flex-1 rounded-xl border border-[var(--color-border)] bg-stone-50 px-4 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-accent)] text-white transition hover:opacity-90 disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m22 2-7 20-4-9-9-4Z" />
                  <path d="M22 2 11 13" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-accent)] text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        {isOpen ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m18 6-12 12" />
            <path d="m6 6 12 12" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
          </svg>
        )}
      </button>
    </div>
  );
}
