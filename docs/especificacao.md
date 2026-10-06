# App do Aposentados FC — Especificação

Documento para o Claude Code. Os wireframes (HTML) estão em `telas/` e o escudo em `escudo.jpeg`. Cada tela abaixo cita o arquivo do wireframe. Onde o texto e o desenho divergirem, **vale o texto**.

## 1. Objetivo

Site instalável (PWA) para a pelada: registra jogos, gols, assistências e cartões, monta os times de cada pelada, calcula ranking e troféus, controla mensalidades e deixa os jogadores se avaliarem. Funciona em iPhone e Android, sem custo de hospedagem ou banco.

## 2. Stack

- **Front:** React + Vite + Tailwind + `vite-plugin-pwa` (instalável pela tela inicial).
- **Back:** Supabase no plano gratuito (Postgres, Auth, Storage, Row Level Security). Sem servidor próprio.
- **Hospedagem:** Vercel ou Netlify (gratuito).
- **Login:** só usuário + senha (sem Google). Quem esquece o usuário ou a senha recupera com o admin (Admin → Jogadores e permissões → chave), que gera uma senha temporária.
- **Fotos:** reduzir no celular (~100 KB) antes de enviar; trocar a foto substitui o arquivo antigo.
- **Instalação:** o menu hambúrguer tem o item "Instalar app". No Android (Chrome), usar o evento `beforeinstallprompt` para abrir o aviso de instalar. No iPhone (Safari) não existe instalação por botão: mostrar as instruções (Compartilhar, Adicionar à Tela de Início, Adicionar). Esconder o item quando o app já roda instalado (`display-mode: standalone`).
- **Backup:** rotina semanal (ex.: GitHub Actions) que exporta os dados em CSV. Serve também para evitar a pausa do projeto por inatividade.
- **Fora do escopo:** modo sem internet, avisos por WhatsApp, importação do caderno antigo (depois, com script).

## 3. Visual

Tema escuro, seguindo o escudo. Fundo `#0B1226`, superfície `#101A38`, borda `#243256`, texto `#E6EAF2`, texto apagado `#8D9AB8`, azul de ação `#3D78FF`, prata `#D8DEE9`. Medalhas: ouro `#D9B44A`, prata `#C0C7D1`, bronze `#B87B4B`. Fonte Barlow. Cores disponíveis para os times (lista fixa, ver seção 11). Navegação: menu hambúrguer + barra inferior (Início, Pelada, Pagamentos, Jogadores). O próprio perfil abre pela foto no topo. Gerar o ícone do PWA (quadrado) a partir do escudo.

## 4. Papéis e tipos de jogador

**Papéis:** dono, admin, jogador (papéis fixos no app) e ajudante (não é papel fixo: é escolhido em cada pelada e vale só até a data dela).
- **Dono:** tem os mesmos direitos do admin e, a mais, escolhe e remove admins. Pode se retirar declarando outro admin como dono: a posse é transferida e ele continua como admin.
- **Admin:** edita e exclui qualquer dado, aprova cadastros, gerencia pagamentos, mensalistas, peladas, times e presets.
- **Ajudante:** escolhido pelo admin por pelada. Registra eventos quando é o responsável pelo registro do jogo.
- **Jogador:** vê tudo; botões de registro aparecem acinzentados e trancados.

**Tipos:**
- **Mensalista:** elencável nas peladas, entra no pódio e nos troféus. Quem vira admin (ou dono) começa como mensalista e ocupa vaga da cota, mas pode ser retirado da mensalidade, como qualquer outro, e continuar admin. Enquanto não for mensalista, não ocupa vaga e conta como diarista nas peladas e no pódio.
- **Diarista:** todo mundo cria perfil normal e começa como diarista. Tem perfil e histórico, mas fora do pódio mensal. Só joga se o admin escolher.
- **Avulso:** sem perfil, criado pelo admin só com nome. Gols e assistências ficam só no histórico do dia.

**Cota:** número máximo de mensalistas, definido pelo admin. Dono e admins ocupam vaga só enquanto forem mensalistas. Admin promove diarista a mensalista só havendo vaga. Retirar um mensalista (por decisão ou atraso) o torna diarista de novo: perfil e histórico continuam, e a vaga fica livre.

## 5. Regras

**Pelada e mês (separar bem as duas coisas):**
- **A pelada é um evento com data:** acontece todo domingo, e cada domingo é uma pelada nova, criada pelo admin com data, horário e local.
- **Tudo do time é da pelada:** a cada pelada o admin escolhe os capitães de novo, e os capitães escolhem de novo os jogadores, o kit (nome + escudo) e a cor. Nada de time passa de uma pelada para outra.
- **O que é do mês são as estatísticas individuais:** gols, assistências, vitórias, pódio e troféus somam todas as peladas do mês. O pódio mostra um mês por vez.

**Pódio (aba Início):** abas Vitórias, Gols, Assistências, Total. Total = gols + assistências. Desempate sempre por vitórias. Empate em tudo: mesma posição e a seguinte é pulada (1, 2, 2, 4). Mostrar o ranking completo; top 3 com destaque visual. Só mensalistas (admin ou dono que não é mensalista conta como diarista e fica fora).

**Vitórias do jogador:** jogos ganhos pelo time em que ele esteve em campo.

**Troféus (mensais):** aparecem no perfil como lista (ícone/emoji, nome do prêmio, mês/ano mais claro). Sem troféu: "Sem troféus ainda".
- **Melhor do mês:** gols + assistências, desempate por vitórias. Premia 1º, 2º e 3º.
- **Artilheiro, Garçom (assistências) e Mais vitórias:** só o 1º lugar.
- **Seleção do mês:** o time com mais vitórias em uma pelada do mês. Desempate pelo time com mais gols; se empatar de novo, os dois levam. Todos que estavam no time nessa pelada ganham.

**Notas:** drible, chute, velocidade, defesa, passe e overall, em 1 a 5 estrelas (estilo Uber). Voto anônimo, sem votar em si mesmo. Opcional: o jogador avalia só quem quiser. Cada avaliador muda cada avaliação **1 vez por pelada** (libera de novo quando o admin encerra a pelada); a nota anterior continua valendo. Média = voto mais recente de cada pessoa. Mostrar a média só com 3 ou mais avaliações.

**Times da pelada** (refeitos a cada pelada):
1. Em cada pelada, o admin escolhe 4 capitães entre os mensalistas. A ordem em que os define é a ordem dos capitães (1 a 4).
2. São 4 rodadas (16 escolhas), nesta ordem: 1-2-3-4 · 4-1-2-3 · 1-2-3-4 · 1-2-3-4. É intencional: a ordem dá vantagem, e o capitão 4 é compensado só na 2ª rodada.
3. Nas primeiras 24 h depois de definir os capitães, a escolha é livre (sem prazo por turno, mas respeitando a ordem).
4. Assim que as 24 h acabam, cada escolha passa a ter 10 min. Sem escolha, o app sorteia um jogador disponível.
5. Cada capitão escolhe um **kit** (nome + escudo, já cadastrados juntos) e uma **cor** (da lista fixa) para a pelada. Na mesma pelada, quem escolhe primeiro bloqueia o kit e a cor para os outros times; na pelada seguinte, tudo volta a ficar livre. Criar kit novo só se o admin habilitar (economia de armazenamento); capitães podem sugerir, e o admin aprova e adiciona à lista.
6. **Sorteio (dias atípicos, só admin):** marca quem joga, escolhe 2 a 4 times, opção de equilibrar pelo overall, troca manual de jogadores entre times e confirma.

**Peladas e jogos:**
- Admin cria a pelada (data, horário, local, limite de vagas, ajudantes, presença aberta). As configurações da pelada, como os ajudantes, valem até a data dela.
- Presença: Vou/Não vou, limite de vagas, lista de espera. Entram mensalistas e os diaristas escolhidos pelo admin (admin não mensalista conta como diarista).
- O admin ou o responsável escolhe os dois times de cada jogo. Não há regra automática de quem fica, sai ou empata.
- O jogo termina com **10 min ou 2 gols**. Ao terminar: tela com placar final e botão Salvar resultado; só admin corrige depois.
- **Responsável pelo registro:** um por jogo, para duas pessoas não marcarem ao mesmo tempo. Pode passar para outro ajudante; o admin assume ou libera. Quem não é o responsável vê os botões trancados.
- **Eventos:** gol (depois, passo 2: quem deu a assistência, ou "sem assistência"), gol contra, cartão amarelo, cartão vermelho, substituição. Gol contra e cartões só registram por enquanto (gol contra conta no placar do adversário e não entra no ranking de gols).
- **Substituição parcial** (na tela do jogo): quem entra pode ser mensalista, diarista cadastrado ou avulso. **Substituição integral:** o admin coloca um diarista (cadastrado ou avulso) no lugar de um mensalista que não vai.
- **Só admin edita ou exclui** eventos.
- **Encerrar pelada:** resumo do dia (artilheiro, garçom, time com mais vitórias). Os números individuais entram nas estatísticas do mês; depois só admin edita.

**Pagamentos:** Pix manual. O jogador toca "Já paguei" e o admin confirma. Cotinhas extras com pagamento próprio. Valor e vencimento da mensalidade são editáveis pelo admin.

**Cadastro e senha:** código de convite + aprovação do admin; entra como diarista. "Esqueci minha senha": o jogador pede, o admin gera uma senha temporária e avisa por fora do app; o jogador troca no primeiro acesso.

## 6. Telas (wireframes em `telas/`)

| Tela | Arquivo | Quem acessa | Resumo |
|---|---|---|---|
| Login | `Login` | todos | usuário/senha, esqueci minha senha, criar conta |
| Cadastro | `Cadastro` | novo | código de convite, nome, usuário, senha |
| Esqueci minha senha | `EsqueciSenha` | todos | pede nova senha ao admin |
| Menu lateral | `Menu` | logados | navegação; seção Admin só para admin |
| Instalar app | `InstalarApp` | logados | item no menu; instruções por plataforma |
| Início: pódio | `Main` | logados | próxima pelada (Vou/Não vou), ranking completo, abas, top 3 |
| Mês sem jogos | `SemJogos` | logados | estado vazio do pódio |
| Pelada de hoje | `PeladaHoje` | logados | times da pelada, jogos do dia, Definir próximo jogo |
| Definir próximo jogo | `ProximoJogo` | admin/responsável | escolhe Time 1 e Time 2 |
| Jogo ao vivo | `Jogo` | admin/ajudante responsável | jogadores com foto, toque abre ação; responsável; editar/excluir (admin) |
| Jogo (visão do jogador) | `JogoBloqueado` | demais | botões trancados, mostra quem registra |
| Escolher ação | `Acao` | quem registra | gol, gol contra, cartões, substituição |
| Assistência | `Assistencia` | quem registra | passo 2 do gol |
| Substituição parcial | `Substituicao` | quem registra | sai/entra: mensalista, diarista ou avulso |
| Responsável pelo registro | `Responsavel` | admin/ajudante | passar, assumir, liberar |
| Editar evento | `EditarEvento` | admin | tipo, autor, assistência, minuto, excluir |
| Erro ao salvar | `Erro` | todos | tentar de novo / cancelar |
| Jogo encerrado | `FimJogo` | quem registra | placar final, salvar |
| Encerrar pelada | `EncerrarPelada` | admin | resumo e consolidação |
| Detalhe do jogo | `DetalheJogo` | logados | placar e linha do tempo |
| Histórico | `Historico` | logados | peladas por mês, filtro de jogador |
| Presença | `Presenca` | logados | vão, não vão, sem resposta, espera |
| Criar pelada | `CriarPelada` | admin | data, horário, local, ajudantes |
| Definir capitães | `DefinirCapitaes` | admin | escolhe os 4 capitães e mostra prazos |
| Escolha dos times | `Capitaes` | capitães | 4 times, turno, disponíveis com estrelas |
| Meu time | `Identidade` | capitão | kit (nome + escudo) e cor; criar bloqueado; sugerir |
| Nomes e escudos | `NomesEscudos` | admin | kits (nome + escudo), liga/desliga criação, aprova sugestões |
| Sorteio / Resultado | `Sorteio`, `SorteioResultado` | admin | dia atípico, troca manual |
| Diarista (integral) | `Diarista` | admin | cadastrado ou avulso no lugar de mensalista |
| Perfil | `Perfil` | logados | foto, filtro mês/ano/geral, estatísticas, notas, troféus, tipo |
| Perfil de outro jogador | `PerfilOutro` | logados | igual, sem editar; avaliar |
| Avaliar colegas / Votar | `AvaliarLista`, `Votar` | logados | lista com estrelas atuais; votação por jogador |
| Pagamentos | `Pagamentos` | logados | mensalidade, Pix, cotinhas, confirmação (admin) |
| Administração | `Admin` | admin | atalhos |
| Cadastros | `Cadastros` | admin | código de convite, aprovações, pedidos de senha |
| Permissões | `Permissoes` | dono/admin | funções; só o dono define admins e passa a posse |
| Passar a posse | `PassarPosse` | dono | escolhe outro admin como novo dono |
| Mensalistas e cota | `Mensalistas` | admin | valor, vencimento, cota, retirar (inclusive admins), promover diaristas |

## 7. Modelo de dados (sugestão)

`profiles` (nome, usuário, foto, papel, tipo, ativo) · `invites` · `signup_requests` · `password_requests` · `peladas` (data, horário, local, status) · `pelada_helpers` (ajudantes por pelada) · `presence` · `guests` (avulsos da pelada) · `teams` (pelada, ordem do capitão, capitão, kit, cor; kit e cor únicos por pelada) · `team_members` (ordem de escolha) · `draft_state` (pelada, fase, prazo do turno) · `kits` (nome + escudo), `suggestions`, `settings` (criação liberada?) · `games` (times, placar, início, fim, responsável) · `lineup` (jogador ou avulso, entrada, saída) · `game_events` (tipo, minuto, autor, assistência, criado por, editado por) · `ratings` e `rating_edits` (1 edição por avaliador por mês) · `fee_config` (valor, vencimento, cota) · `payments` e `extra_charges` · `awards` (mês, tipo, jogador, posição).

Pódio e troféus devem sair de consultas (views) sobre `game_events` e `games`, calculadas por mês a partir da data de cada pelada (fuso de São Paulo).

## 8. Permissões (RLS)

Jogador lê tudo e escreve só no próprio perfil, nas próprias avaliações e na própria presença. Responsável pelo registro escreve eventos do jogo dele. Admin escreve e exclui em tudo. Só o dono altera papéis de admin e transfere a posse. Fotos: cada um escreve só na própria pasta.

## 9. Fases

1. **Base:** PWA instalável (item "Instalar app" no menu), login, cadastro com convite e aprovação, perfil com foto, papéis, peladas, jogos, eventos, responsável, pódio mensal, menu e erros.
2. **Organização:** presença, mensalistas e cota, capitães e escolha dos times, sorteio, diarista e substituições, encerrar jogo e pelada, histórico.
3. **Social e dinheiro:** notas, troféus, pagamentos e cotinhas.
4. **Extras:** esqueci minha senha refinado, exportação semanal, ajustes de visual.

## 10. Suposições a confirmar

- Quem avalia e é avaliado: apenas mensalistas.
- Sorteio por falta de escolha do capitão: entre os jogadores ainda disponíveis.
- Gol contra: conta no placar, não entra no ranking de gols; cartões não geram suspensão.

## 11. Decisões (respostas às dúvidas da especificação)

Estas decisões valem sobre o texto acima e sobre os wireframes.

- **Admin não mensalista:** conta como diarista (fora do pódio e dos troféus, sem presença automática). Os textos "mensalistas e admins" em `CriarPelada` e `Presenca` estão desatualizados.
- **Ajudante:** só por pelada. O item "Ajudante" na lista de funções de `Permissoes` está errado; lá ficam só Dono, Admin e Jogador.
- **Pelada todo domingo:** cada pelada tem data e tudo dela (ajudantes, capitães, times, kits, cores) vale só para ela. Onde os wireframes dizem "Sábado", leia domingo; onde dizem "Times do mês" ou "times valem pelo mês", leia "times da pelada".
- **Mês = estatísticas individuais:** pódio, troféus e estatísticas do perfil somam as peladas do mês.
- **Prazo da escolha:** a escolha dos times precisa terminar antes do horário da pelada.
- **Escolha dos times:** 24 h livres e, em seguida, 10 min por escolha (sem esperar as 18h). Ordem: 1-2-3-4 · 4-1-2-3 · 1-2-3-4 · 1-2-3-4.
- **Times sem cor fixa:** até escolher a cor, o time é identificado pelo capitão ("Time de Fulano").
- **Quem vira admin:** começa como mensalista, mas pode ser retirado da mensalidade e continuar admin. O texto de `PassarPosse.html` que diz "automaticamente" está desatualizado.
- **Kits:** o admin cadastra kits prontos (escudo JPG + nome). As imagens são reduzidas no celular antes do upload.
- **Cores fixas:**

| Cor | Hex |
|---|---|
| Azul | `#2D5BA8` |
| Vermelho | `#B3362B` |
| Branco | `#D8DEE9` |
| Preto | `#1B1B1B` |
| Verde | `#2E8B57` |
| Amarelo | `#E0B000` |
| Laranja | `#E06A1F` |
| Roxo | `#6B3FA0` |
| Cinza | `#7A8394` |
| Grená | `#7A1F2B` |

## 12. Decisões de implementação (a confirmar com o uso)

- **Quem pode ser escolhido pelos capitães:** só quem confirmou presença ("Vou", fora da lista de espera). Se a escolha não terminar até o horário da pelada, o app sorteia o restante.
- **Notas:** cada jogador avaliado pode ter a nota mudada 1 vez por pelada (entre um encerramento e o próximo). Quem avaliou antes de existirem defesa e passe pode completar sem gastar a mudança.
- **Troféus:** aparecem quando o mês fecha (a partir do dia 1º do mês seguinte).
- **Mensalidades e cotinhas:** cada cobrança vale para os mensalistas do momento em que foi criada. A do mês atual é criada sozinha (valor > 0); o admin cria a do mês seguinte quando quiser (até 2 meses à frente). Quem vira mensalista entra na do mês e nas já criadas para frente, nunca nas antigas. O jogador vê tudo que está em aberto (atrasadas, do mês, adiantadas) e o histórico pago. O admin pode dispensar alguém de uma cobrança.
- **Sorteio equilibrado:** jogador sem overall (menos de 3 avaliações) conta como 3.
- **Senha temporária:** o admin gera no app (Admin → Cadastros) e passa por fora; o jogador é obrigado a criar a dele no próximo acesso.
- **Backup:** GitHub Action a cada 3 dias, criptografado (o repositório é público).

## 13. Caixa (só admins)

- Entradas, gastos e saldo do mês, com saldo acumulado de um mês para o outro.
- Toda entrada diz com qual admin/dono o dinheiro ficou; todo gasto, quem pagou. O caixa mostra quanto cada um tem.
- Confirmar mensalidade ou cotinha lança a entrada sozinha (escolhendo quem recebeu). "Desfazer" estorna e volta o pagamento para pendente.
- Diarista que entra no lugar de mensalista pode ter pago para jogar: valor e quem recebeu entram no caixa.
- Lançamentos manuais: entrada avulsa, gasto (nome e valor) e repasse entre admins (não muda o total).
- Auditável: nada é apagado; estorno guarda motivo, quem e quando. Exporta CSV do mês.

## 14. Vagas de diarista e empréstimo

- Quando acabam os jogadores disponíveis, o capitão da vez escolhe "Vaga de diarista" (só quando não sobra ninguém). Prazo vencido ou horário da pelada: vira vaga sozinho. Cada time fecha com 5.
- No dia, admin ou ajudante preenche a vaga: avulso, diarista com conta ou mensalista de última hora, com "pagou para jogar" indo para o caixa. Vaga não preenchida não entra em campo.
- Substituição parcial e "Emprestar jogador" (sem tirar ninguém) aceitam alguém de outro time; vale só naquele jogo, e no próximo jogo do time dele ele volta para o time original.
