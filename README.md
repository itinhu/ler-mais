# LER+ — Fluência Leitora

Aplicativo de avaliação de leitura com painel do professor, acesso de responsáveis, Firebase Authentication/Firestore e transcrição de áudio por IA.

**Status:** versão de desenvolvimento. Não utilizar com dados reais de crianças até configurar backend, revisar permissões, consentimento e validar precisão.

## Estrutura
- `public/`: interface e configuração pública Firebase
- `api/index.js`: API autenticada e avaliação por transcrição
- `firestore.rules`: acesso direto bloqueado (servidor usa Firebase Admin)
- `vercel.json`: roteamento e função serverless

## Configuração na Vercel
Criar variáveis de ambiente privadas:
- `TEACHER_EMAILS`: lista de e-mails de professores autorizados, separados por vírgula
- `FIREBASE_SERVICE_ACCOUNT_JSON`: credencial JSON da conta de serviço Firebase (NUNCA publicar)
- `OPENAI_API_KEY`: chave privada de API (NUNCA publicar)

`public/firebase-config.js` contém somente parâmetros públicos do app Web Firebase.

Para desenvolvimento: `npm install`, `npm run check` e `vercel dev`.

**Aviso pedagógico:** PCPM e precisão são estimativas obtidas de transcrição/alinhamento. Não representam avaliação fonológica validada; requerem revisão humana. As gravações são processadas pelo serviço de transcrição e não são persistidas pelo aplicativo nesta versão. Planejar consentimento, retenção e controle de acesso antes de usar com menores.
