import { isIOS, useInstallPrompt } from '../lib/install'

const IOS_STEPS = ['Toque no botão Compartilhar.', 'Escolha "Adicionar à Tela de Início".', 'Toque em "Adicionar".']

export default function InstallSheet({ onClose }) {
  const { canPrompt, prompt } = useInstallPrompt()

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[rgba(4,7,16,.78)]" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-2xl border-t border-line-2 bg-surface px-4 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3 h-1 w-10 rounded bg-line-2" />
        <div className="text-xl font-bold">Instalar o app na tela inicial</div>
        <div className="mt-1 mb-3 text-sm text-muted">Abre em tela cheia, com o escudo como ícone.</div>

        {!isIOS() && (
          <div className="card mb-2">
            <b>Android (Chrome)</b>
            <button className="btn mt-2 w-full" disabled={!canPrompt} onClick={() => prompt().then(onClose)}>
              Instalar agora
            </button>
            {!canPrompt && (
              <div className="mt-2 text-xs text-muted">
                Se o botão não ativar, use o menu ⋮ do Chrome e toque em "Instalar app".
              </div>
            )}
          </div>
        )}

        <div className="card mb-2">
          <b>iPhone (Safari)</b>
          {IOS_STEPS.map((t, i) => (
            <div key={t} className="mt-1.5 flex gap-2 text-sm">
              <b className="w-4">{i + 1}</b>
              <span>{t}</span>
            </div>
          ))}
        </div>
        <div className="mb-2 text-xs text-muted">
          No iPhone precisa ser pelo Safari. Este item some do menu quando o app já está instalado.
        </div>
        <button className="h-11 w-full text-sm text-muted" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  )
}
