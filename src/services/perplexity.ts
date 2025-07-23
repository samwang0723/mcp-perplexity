export interface PerplexityMessage {
  role: string;
  content: string;
}

interface PerplexityChoice {
  message: {
    content: string;
    role: string;
  };
}

interface PerplexityResponse {
  choices: PerplexityChoice[];
  citations?: string[];
}

export class PerplexityService {
  private apiKey: string;
  private baseUrl = 'https://api.perplexity.ai/chat/completions';

  constructor() {
    this.apiKey = process.env.PERPLEXITY_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('PERPLEXITY_API_KEY environment variable is required');
    }
  }

  async performChatCompletion(
    messages: PerplexityMessage[],
    model: string = 'sonar-pro'
  ): Promise<string> {
    const body = {
      model: model,
      messages: messages,
    };

    let response;
    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`Network error while calling Perplexity API: ${error}`);
    }

    if (!response.ok) {
      let errorText;
      try {
        errorText = await response.text();
      } catch (parseError) {
        errorText = 'Unable to parse error response';
      }
      throw new Error(
        `Perplexity API error: ${response.status} ${response.statusText}\n${errorText}`
      );
    }

    let data: PerplexityResponse;
    try {
      data = (await response.json()) as PerplexityResponse;
    } catch (jsonError) {
      throw new Error(
        `Failed to parse JSON response from Perplexity API: ${jsonError}`
      );
    }

    let messageContent = data.choices[0].message.content;

    if (
      data.citations &&
      Array.isArray(data.citations) &&
      data.citations.length > 0
    ) {
      messageContent += '\n\nCitations:\n';
      data.citations.forEach((citation: string, index: number) => {
        messageContent += `[${index + 1}] ${citation}\n`;
      });
    }

    return messageContent;
  }

  async ask(messages: PerplexityMessage[]): Promise<string> {
    return this.performChatCompletion(messages, 'sonar-pro');
  }

  async research(messages: PerplexityMessage[]): Promise<string> {
    return this.performChatCompletion(messages, 'sonar-deep-research');
  }

  async reason(messages: PerplexityMessage[]): Promise<string> {
    return this.performChatCompletion(messages, 'sonar-reasoning-pro');
  }
}
