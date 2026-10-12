type OraLike = {
  text: string;
  isSpinning: boolean;
  start: () => OraLike;
  stop: () => OraLike;
  succeed: (_text?: string) => OraLike;
  fail: (_text?: string) => OraLike;
};

function createOra(text = ''): OraLike {
  return {
    text,
    isSpinning: false,
    start() {
      this.isSpinning = true;
      return this;
    },
    stop() {
      this.isSpinning = false;
      return this;
    },
    succeed(nextText?: string) {
      if (nextText) {
        this.text = nextText;
      }
      this.isSpinning = false;
      return this;
    },
    fail(nextText?: string) {
      if (nextText) {
        this.text = nextText;
      }
      this.isSpinning = false;
      return this;
    },
  };
}

export type Ora = OraLike;

export default function ora(options?: string | { text?: string }): OraLike {
  const text = typeof options === 'string' ? options : (options?.text ?? '');
  return createOra(text);
}
