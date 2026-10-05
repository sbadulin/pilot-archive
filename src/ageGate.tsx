import { useState, type ReactNode } from "react";

// Архив публикуется в исходном виде, поэтому маркирован 18+ (436-ФЗ «О защите детей от
// информации»). Закон требует ограничить доступ, а не проверять документы: достаточно
// подтверждения возраста, которое браузер запоминает.
export const adultConfirmedKey = "pilot-adult-confirmed";

function readConfirmed(): boolean {
  try {
    return localStorage.getItem(adultConfirmedKey) === "1";
  } catch {
    return false;
  }
}

function rememberConfirmed() {
  try {
    localStorage.setItem(adultConfirmedKey, "1");
  } catch {
    // Без хранилища подтверждение действует до перезагрузки страницы.
  }
}

export function AdultBadge() {
  return (
    <span className="adult-badge" title="Материалы для читателей старше 18 лет">
      18+
    </span>
  );
}

export function AgeGate({ children }: { children: ReactNode }) {
  const [confirmed, setConfirmed] = useState(readConfirmed);
  const [declined, setDeclined] = useState(false);
  if (confirmed) return <>{children}</>;
  return (
    <main className="age-gate">
      <div className="age-gate-card" role="dialog" aria-modal="true" aria-labelledby="age-gate-title">
        <span className="age-gate-mark" aria-hidden="true">
          18+
        </span>
        <h1 id="age-gate-title">Архив для взрослых читателей</h1>
        {declined ? (
          <p>Архив доступен только читателям старше 18 лет.</p>
        ) : (
          <>
            <p>
              «Первый Пилот» — молодёжная газета 1996–2007 годов. Материалы публикуются в исходном
              виде и могут содержать сведения, не предназначенные для детей.
            </p>
            <div className="age-gate-actions">
              <button
                className="age-gate-confirm"
                autoFocus
                onClick={() => {
                  rememberConfirmed();
                  setConfirmed(true);
                }}
              >
                Мне есть 18 лет
              </button>
              <button className="age-gate-decline" onClick={() => setDeclined(true)}>
                Мне нет 18
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
