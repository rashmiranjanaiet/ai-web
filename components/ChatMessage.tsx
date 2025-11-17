
import React from 'react';
import { Message, ChatRole } from '../types';
import { UserIcon, BotIcon, SearchIcon, MapPinIcon } from './icons';
import { marked } from 'marked';

interface ChatMessageProps {
  message: Message;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === ChatRole.USER;
  const rawMarkup = message.text ? marked.parse(message.text) as string : '';

  return (
    <div className={`flex items-start gap-4 my-4 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center">
          <BotIcon className="w-6 h-6 text-white" />
        </div>
      )}
      <div className={`max-w-xl p-4 rounded-xl shadow-md ${isUser ? 'bg-blue-600 rounded-br-none' : 'bg-gray-700 rounded-bl-none'}`}>
        {message.isLoading ? (
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-gray-300 animate-pulse"></div>
            <div className="w-2 h-2 rounded-full bg-gray-300 animate-pulse delay-75"></div>
            <div className="w-2 h-2 rounded-full bg-gray-300 animate-pulse delay-150"></div>
          </div>
        ) : (
          <div className="prose prose-invert prose-p:my-0 prose-headings:my-2" dangerouslySetInnerHTML={{ __html: rawMarkup }} />
        )}

        {message.sources && message.sources.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-600">
            <h4 className="text-xs font-semibold text-gray-400 mb-2">Sources:</h4>
            <div className="flex flex-wrap gap-2">
              {message.sources.map((source, index) => (
                <a
                  key={index}
                  href={source.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-gray-600 hover:bg-gray-500 text-gray-200 text-xs px-2 py-1 rounded-md flex items-center gap-1.5 transition-colors"
                >
                  {source.type === 'search' ? <SearchIcon className="w-3 h-3" /> : <MapPinIcon className="w-3 h-3" />}
                  <span>{source.title}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center">
          <UserIcon className="w-6 h-6 text-gray-300" />
        </div>
      )}
    </div>
  );
};

export default ChatMessage;
