import React, {useState, useEffect, useRef, useCallback} from 'react';
import {useLocation, useParams} from 'react-router-dom';
import DOMPurify from 'dompurify';

type Message = {
    sender: 'user' | 'bot';
    text: string;
};

type QuickReply = {
    value: string;
};

const Chat: React.FC = () => {
    const [input, setInput] = useState<string>('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
    const [isBotTyping, setIsBotTyping] = useState<boolean>(false);
    const [hasNewMessages, setHasNewMessages] = useState<boolean>(false);
    const [, setAutoScroll] = useState<boolean>(true);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [isManagedBots, setIsManagedBots] = useState<boolean>(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);

    const {intent, environment, userId: userIdFromParams, botId} = useParams();
    const location = useLocation();

    const userId = userIdFromParams != null ? userIdFromParams : new URLSearchParams(location.search).get('userId');

    const eddiBaseUrl = ''; // const eddiBaseUrl = 'http://localhost:7070';

    const startConversation = useCallback(async () => {

        fetch(`${eddiBaseUrl}/bots/${environment}/${botId}?userId=${userId}`, {
            method: 'POST'
        }).then(response => {
            // Extract the Location header
            const locationHeader = response.headers.get('Location');
            console.log('Location Header:', locationHeader);

            if (locationHeader) {
                // Assuming the conversationId is the last segment in the URI
                const segments = locationHeader.split('/');
                const conversationId = segments[segments.length - 1];
                setConversationId(conversationId);
                console.log('Extracted conversationId:', conversationId);
            } else {
                console.error('Location header is missing in the response.');
            }
        }).catch(reason => console.log('Error while creating conversation' + reason));
    }, [botId, environment, userId]);

    useEffect(() => {
        const currentPath = window.location.pathname;
        const isManagedBots = currentPath.startsWith('/chat/managedbots');
        setIsManagedBots(isManagedBots);
        if (!isManagedBots) {
            startConversation();
        }
    }, [isManagedBots, startConversation]);

    const loadConversation = useCallback(async () => {
        if (isManagedBots) {
            if (!intent || !userId) return;
        } else {
            if (!conversationId || !environment || !botId) return;
        }

        let fetchUrl: string;
        const queryParams = new URLSearchParams({
            returnDetailed: 'false',
            returnCurrentStepOnly: 'true',
        });

        if (isManagedBots) {
            fetchUrl = `${eddiBaseUrl}/managedbots/${intent}/${userId}?${queryParams}`;
        } else {
            fetchUrl = `${eddiBaseUrl}/bots/${environment}/${botId}/${conversationId}?${queryParams}`;
        }

        fetchEndpoint(fetchUrl, 'GET', null);
    }, [botId, conversationId, environment, intent, isManagedBots, userId]);

    useEffect(() => {
        loadConversation();
    }, [conversationId, intent, loadConversation])

    const scrollToBottom = () => {
        if (messagesContainerRef.current) {
            let scrollHeight = messagesContainerRef.current.scrollHeight;
            messagesContainerRef.current.scrollTop = scrollHeight;

            // Use setTimeout to give the browser time to render and update scroll positions
            setTimeout(() => {
                if (messagesContainerRef.current) {
                    const scrollTop = messagesContainerRef.current.scrollTop;
                    const clientHeight = messagesContainerRef.current.clientHeight;
                    const isAtBottom = scrollHeight - scrollTop - clientHeight <= 5; // tolerance of 5px
                    setHasNewMessages(!isAtBottom);
                }
            }, 100); // Adjust the timeout as needed
        }
        setAutoScroll(true);
    };

    useEffect(() => {
        scrollToBottom();
        setAutoScroll(true);
    }, [messages]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInput(e.target.value);
    };

    const handleQuickReply = (quickReply: QuickReply) => {
        sendMessage(quickReply.value);
        setQuickReplies([]);
    };

    const sendMessage = async (userInput: string) => {
        if (!userInput.trim()) return;
        const userMessage: Message = {sender: 'user', text: userInput};
        setMessages(currentMessages => [...currentMessages, userMessage]);
        setIsBotTyping(true);

        const endpoint = isManagedBots ?
            `${eddiBaseUrl}/managedbots/${intent}/${userId}` :
            `${eddiBaseUrl}/bots/${environment}/${botId}/${conversationId}?userId=${userId}`;

        fetchEndpoint(endpoint, 'POST', userInput);
    };

    const fetchEndpoint = (url: string, method: string, userInput: string | null) => {
        const headers = {'Content-Type': 'application/json'};
        const body = JSON.stringify({input: userInput});
        const init = method === 'POST' ? {method, headers, body} : {method, headers};

        fetch(url, init)
            .then(response => response.json())
            .then(data => {
                setIsBotTyping(false);

                if (data.conversationState === 'ERROR') {
                    console.log('ConversationState was ERROR.');
                }

                const botReplies: any[] = data.conversationOutputs[0].output || [];
                botReplies.forEach(reply => {
                    setMessages(currentMessages => [...currentMessages, {sender: 'bot', text: reply.text}]);
                });

                const botQuickReplies: QuickReply[] = data.conversationOutputs[0].quickReplies || [];
                setQuickReplies(botQuickReplies);

                setAutoScroll(true);
            }).catch(error => {
            console.error(error);
            setIsBotTyping(false);
        });
    }

    const handleScroll = () => {
        if (messagesContainerRef.current) {
            const current = messagesContainerRef.current;
            const isAtBottom = current.scrollHeight - current.scrollTop - current.clientHeight <= 5; // tolerance of 5px

            if (isAtBottom) {
                setHasNewMessages(false);
            } else if (!hasNewMessages) {
                setHasNewMessages(true);
            }
        }
    };

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        sendMessage(input);
        setInput('');
    };

    return (
        <div>
            <img id='eddiLogo' className='chatImg' src='/img/logo_eddi.png' alt='EDDI Logo'/>
            <div className='chat-container'>
                <div className='messages' onScroll={handleScroll} ref={messagesContainerRef}>
                    {messages.map((msg, index) => (
                        <div key={index} className={`message ${msg.sender}`}>
                            {msg.sender === 'bot'
                                ? <div dangerouslySetInnerHTML={{
                                    __html: DOMPurify.sanitize(
                                        msg.text.replace(/(\\n)/g, '<br>'))
                                }}/>
                                : msg.text
                            }
                        </div>
                    ))}
                    {isBotTyping && <div className='loading-indicator'>
                        <img src='/img/loading-indicator.svg' alt='Answer is being generated...'/>
                    </div>}
                    <div ref={messagesEndRef}/>
                </div>
                {hasNewMessages && (
                    <button onClick={scrollToBottom} className='scroll-to-bottom'>
                    </button>
                )}
                {quickReplies.length > 0 && (
                    <div className='quick-replies'>
                        {quickReplies.map((quickReply, index) => (
                            <button key={index} onClick={() => handleQuickReply(quickReply)}>
                                {quickReply.value}
                            </button>
                        ))}
                    </div>
                )}
                <form onSubmit={handleSubmit} className='message-form'>
                    <input
                        type='text'
                        value={input}
                        onChange={handleInputChange}
                        placeholder='Type a message...'
                    />
                    <button type='submit'>Send</button>
                </form>
            </div>
        </div>
    );
};

export default Chat;
