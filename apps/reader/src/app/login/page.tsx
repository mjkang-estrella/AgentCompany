import styles from "./page.module.css";

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <a href="/" className={styles.logoRow}>
          <div className={styles.logoMark}>r</div>
          <span className={styles.logoText}>readwise</span>
        </a>

        <div className={styles.socialStack}>
          <button type="button" className={`${styles.socialButton} ${styles.amazon}`}>
            <span className={styles.socialMark}>a</span>
            <span>Sign in with Amazon</span>
          </button>
          <button type="button" className={styles.socialButton}>
            <span className={styles.socialMark}>A</span>
            <span>Sign in with Apple</span>
          </button>
        </div>

        <div className={styles.divider}>
          <span>or</span>
        </div>

        <form className={styles.form}>
          <input type="email" placeholder="email" aria-label="email" />
          <input type="password" placeholder="password" aria-label="password" />
          <button type="submit" className={styles.submitButton}>
            Sign in with Email
          </button>
        </form>

        <div className={styles.footerLinks}>
          <a href="#forgot">forgot password?</a>
          <a href="#signup">Don&apos;t have an account? Sign up</a>
        </div>
      </section>
    </main>
  );
}
