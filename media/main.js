const vscode = acquireVsCodeApi();
let currentQuestionId = null;
let questions = [];

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

function updateQuestionDisplay() {
  const questionText = document.getElementById("question-text");
  const selectedQuestion = questions.find((q) => q.id === currentQuestionId);

  if (selectedQuestion) {
    const copyButton = questionText.querySelector("#copy-button");
    questionText.innerHTML = selectedQuestion.processedQuestion;

    if (copyButton) {
      questionText.appendChild(copyButton);
    }

    questionText
      .querySelectorAll("a[data-file-uri], code[data-file-uri]")
      .forEach((element) => {
        element.addEventListener("click", (event) => {
          event.preventDefault();
          const fileUri = element.getAttribute("data-file-uri");
          const startLine = element.getAttribute("data-start-line");
          const endLine = element.getAttribute("data-end-line");
          if (fileUri) {
            vscode.postMessage({
              type: "openFile",
              fileUri: fileUri,
              startLine: startLine ? parseInt(startLine, 10) : undefined,
              endLine: endLine ? parseInt(endLine, 10) : undefined,
            });
          }
        });
      });

    questionText.style.display = "block";

    if (typeof Prism !== "undefined") {
      Prism.highlightAllUnder(questionText);
    }
  } else {
    questionText.style.display = "none";
  }
}

function selectQuestion(questionId) {
  currentQuestionId = questionId;
  updateQuestionDisplay();
}

function sendAnswer() {
  const answerTextarea = document.getElementById("answer-textarea");
  const answer = answerTextarea.value.trim();

  if (answer && currentQuestionId) {
    vscode.postMessage({
      type: "answer",
      answer,
      questionId: currentQuestionId,
    });
    answerTextarea.value = "";
  }
}

window.addEventListener("message", (event) => {
  const message = event.data;

  if (message.type === "questions") {
    questions = message.questions;

    if (questions.length > 0) {
      document.getElementById("no-question").style.display = "none";
      document.getElementById("question-container").style.display = "block";

      selectQuestion(questions[0].id);
    } else {
      document.getElementById("question-container").style.display = "none";
      document.getElementById("no-question").style.display = "block";
    }
  } else if (message.type === "selectQuestion") {
    // NEW: Handle question selection from toolbar
    selectQuestion(message.questionId);
  } else if (message.type === "restoreAnswerText") {
    const textarea = document.getElementById("answer-textarea");
    if (textarea) {
      textarea.value = message.answerText || "";
    }
  }
});

document.getElementById("send-button").addEventListener("click", sendAnswer);

document.getElementById("answer-textarea").addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    sendAnswer();
  }
});

document
  .getElementById("answer-textarea")
  .addEventListener("input", (event) => {
    const answerText = event.target.value || "";
    vscode.postMessage({
      type: "updateAnswerText",
      answerText: answerText,
    });
  });

function copyCurrentQuestion() {
  const selectedQuestion = questions.find((q) => q.id === currentQuestionId);
  if (!selectedQuestion) {
    return;
  }

  const copyButton = document.getElementById("copy-button");
  const copyIcon = copyButton.querySelector(".codicon");

  navigator.clipboard
    .writeText(selectedQuestion.question)
    .then(() => {
      copyIcon.className = "codicon codicon-check";
      setTimeout(() => {
        copyIcon.className = "codicon codicon-copy";
      }, 1000);
    })
    .catch(() => {
      copyIcon.className = "codicon codicon-warning";
      setTimeout(() => {
        copyIcon.className = "codicon codicon-copy";
      }, 1000);
    });
}
document
  .getElementById("copy-button")
  .addEventListener("click", copyCurrentQuestion);
