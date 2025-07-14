const vscode = acquireVsCodeApi();
let currentQuestionId = null;
let questions = [];
let selectedChoices = new Set(); // For single/multiple selection tracking
let currentChoiceConfig = null;

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

    updateChoicesDisplay(selectedQuestion.choice);
  } else {
    questionText.style.display = "none";
    updateChoicesDisplay(null);
  }
}

function selectQuestion(questionId) {
  currentQuestionId = questionId;
  selectedChoices.clear();
  updateQuestionDisplay();
}

function sendAnswer() {
  const finalAnswer = createFinalAnswer();

  if (finalAnswer && currentQuestionId) {
    vscode.postMessage({
      type: "answer",
      answer: finalAnswer,
      questionId: currentQuestionId,
    });
    const answerTextarea = document.getElementById("answer-textarea");
    answerTextarea.value = "";
    selectedChoices.clear();
    updateSelectionUI();
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
      document.getElementById("answer-textarea").value = "";
    }
  } else if (message.type === "selectQuestion") {
    selectQuestion(message.questionId);
  } else if (message.type === "restoreAnswerText") {
    const textarea = document.getElementById("answer-textarea");
    if (textarea) {
      textarea.value = message.answerText || "";
    }
  }
});

document.getElementById("send-button").addEventListener("click", sendAnswer);

function updateChoicesDisplay(choiceConfig) {
  const container = document.getElementById("choices-container");
  const choicesList = document.getElementById("choices-list");

  currentChoiceConfig = choiceConfig;
  selectedChoices.clear();

  if (choiceConfig && choiceConfig.choices.length > 0) {
    container.style.display = "block";
    choicesList.innerHTML = "";

    choiceConfig.choices.forEach((choice, index) => {
      const card = document.createElement("div");
      card.className = "choice-card";

      const descriptionHtml = choice.processedDescription;

      if (choiceConfig.multiple) {
        card.innerHTML = `
          <label class="choice-container" for="choice-${index}">
            <input type="checkbox" class="choice-checkbox" id="choice-${index}" value="${choice.label}">
            <div class="choice-content">
              <div class="choice-title">${choice.label}</div>
              <div class="choice-description">${descriptionHtml}</div>
            </div>
          </label>
        `;

        const checkbox = card.querySelector('input[type="checkbox"]');
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            selectedChoices.add(choice.label);
          } else {
            selectedChoices.delete(choice.label);
          }
          updateSelectionUI();
        });
      } else {
        card.innerHTML = `
          <div class="choice-container">
            <div class="choice-content">
              <div class="choice-title">${choice.label}</div>
              <div class="choice-description">${descriptionHtml}</div>
            </div>
          </div>
        `;

        card.addEventListener("click", () => {
          selectedChoices.clear();
          selectedChoices.add(choice.label);
          updateSelectionUI();
        });
      }

      choicesList.appendChild(card);
    });
    if (typeof Prism !== "undefined") {
      Prism.highlightAllUnder(choicesList);
    }
  } else {
    container.style.display = "none";
  }
}

function updateSelectionUI() {
  if (currentChoiceConfig && !currentChoiceConfig.multiple) {
    document.querySelectorAll(".choice-card").forEach((card) => {
      card.classList.remove("selected");
      const title = card.querySelector(".choice-title")?.textContent;
      if (title && selectedChoices.has(title)) {
        card.classList.add("selected");
      }
    });
  }
}

function createFinalAnswer() {
  const textarea = document.getElementById("answer-textarea");
  const textContent = textarea.value.trim();

  if (selectedChoices.size === 0) {
    return textContent;
  }

  if (!textContent) {
    return Array.from(selectedChoices).join(", ");
  }
  const selectionText = Array.from(selectedChoices).join(", ");
  return selectionText + "\n\n" + textContent;
}

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
