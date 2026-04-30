const vscode = acquireVsCodeApi();
let currentQuestionId = null;
let questions = [];
let selectedChoices = new Set(); // For single/multiple selection tracking
let answerTextByQuestionId = new Map();
let selectedChoicesByQuestionId = new Map();
let currentChoiceConfig = null;

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function getAnswerTextarea() {
  return document.getElementById("answer-textarea");
}

function persistSelectedChoices() {
  if (!currentQuestionId) {
    return;
  }

  const selectedChoiceList = Array.from(selectedChoices);
  if (selectedChoices.size > 0) {
    selectedChoicesByQuestionId.set(currentQuestionId, selectedChoiceList);
  } else {
    selectedChoicesByQuestionId.delete(currentQuestionId);
  }

  vscode.postMessage({
    type: "updateSelectedChoices",
    questionId: currentQuestionId,
    selectedChoices: selectedChoiceList,
  });
}

function persistCurrentDraft() {
  if (!currentQuestionId) {
    return;
  }

  const answerText = getAnswerTextarea().value || "";
  if (answerText) {
    answerTextByQuestionId.set(currentQuestionId, answerText);
  } else {
    answerTextByQuestionId.delete(currentQuestionId);
  }
  persistSelectedChoices();

  vscode.postMessage({
    type: "updateAnswerText",
    questionId: currentQuestionId,
    answerText: answerText,
  });
}

function restoreCurrentDraft() {
  const answerTextarea = getAnswerTextarea();
  answerTextarea.value = currentQuestionId
    ? answerTextByQuestionId.get(currentQuestionId) || ""
    : "";
  selectedChoices = new Set(
    currentQuestionId
      ? selectedChoicesByQuestionId.get(currentQuestionId) || []
      : [],
  );
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

function selectQuestion(questionId, persistDraft = true) {
  if (persistDraft) {
    persistCurrentDraft();
  }
  currentQuestionId = questionId;
  restoreCurrentDraft();
  updateQuestionDisplay();
}

function sendAnswer() {
  const finalAnswer = createFinalAnswer();

  if (finalAnswer && currentQuestionId) {
    const answeredQuestionId = currentQuestionId;
    vscode.postMessage({
      type: "answer",
      answer: finalAnswer,
      questionId: answeredQuestionId,
    });
    answerTextByQuestionId.delete(answeredQuestionId);
    selectedChoicesByQuestionId.delete(answeredQuestionId);
    const answerTextarea = getAnswerTextarea();
    answerTextarea.value = "";
    selectedChoices.clear();
    updateSelectionUI();
  }
}

window.addEventListener("message", (event) => {
  const message = event.data;

  if (message.type === "questions") {
    persistCurrentDraft();
    questions = message.questions;

    if (questions.length > 0) {
      const questionIds = new Set(questions.map((question) => question.id));
      for (const questionId of answerTextByQuestionId.keys()) {
        if (!questionIds.has(questionId)) {
          answerTextByQuestionId.delete(questionId);
        }
      }
      for (const questionId of selectedChoicesByQuestionId.keys()) {
        if (!questionIds.has(questionId)) {
          selectedChoicesByQuestionId.delete(questionId);
        }
      }

      document.getElementById("no-question").style.display = "none";
      document.getElementById("question-container").style.display = "block";

      const nextQuestion = questionIds.has(currentQuestionId)
        ? currentQuestionId
        : questions[0].id;
      selectQuestion(nextQuestion, false);
    } else {
      currentQuestionId = null;
      answerTextByQuestionId.clear();
      selectedChoicesByQuestionId.clear();
      selectedChoices.clear();
      document.getElementById("question-container").style.display = "none";
      document.getElementById("no-question").style.display = "block";
      getAnswerTextarea().value = "";
    }
  } else if (message.type === "selectQuestion") {
    selectQuestion(message.questionId);
  } else if (message.type === "restoreAnswerTextByQuestionId") {
    answerTextByQuestionId = new Map(
      Object.entries(message.answerTextByQuestionId || {}),
    );
    if (currentQuestionId) {
      getAnswerTextarea().value =
        answerTextByQuestionId.get(currentQuestionId) || "";
    }
  } else if (message.type === "restoreSelectedChoicesByQuestionId") {
    selectedChoicesByQuestionId = new Map(
      Object.entries(message.selectedChoicesByQuestionId || {}),
    );
    if (currentQuestionId) {
      selectedChoices = new Set(
        selectedChoicesByQuestionId.get(currentQuestionId) || [],
      );
      updateSelectionUI();
    }
  }
});

document.getElementById("send-button").addEventListener("click", sendAnswer);

function updateChoicesDisplay(choiceConfig) {
  const container = document.getElementById("choices-container");
  const choicesList = document.getElementById("choices-list");

  currentChoiceConfig = choiceConfig;

  if (choiceConfig && choiceConfig.choices.length > 0) {
    container.style.display = "block";
    choicesList.innerHTML = "";

    choiceConfig.choices.forEach((choice, index) => {
      const card = document.createElement("div");
      card.className = "choice-card";

      const labelHtml = escapeHtml(choice.label);
      const descriptionHtml = choice.processedDescription;

      if (choiceConfig.multiple) {
        card.innerHTML = `
          <label class="choice-container" for="choice-${index}">
            <input type="checkbox" class="choice-checkbox" id="choice-${index}">
            <div class="choice-content">
              <div class="choice-title">${labelHtml}</div>
              <div class="choice-description">${descriptionHtml}</div>
            </div>
          </label>
        `;

        const checkbox = card.querySelector('input[type="checkbox"]');
        checkbox.checked = selectedChoices.has(choice.label);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            selectedChoices.add(choice.label);
          } else {
            selectedChoices.delete(choice.label);
          }
          persistSelectedChoices();
          updateSelectionUI();
        });
      } else {
        card.innerHTML = `
          <div class="choice-container">
            <div class="choice-content">
              <div class="choice-title">${labelHtml}</div>
              <div class="choice-description">${descriptionHtml}</div>
            </div>
          </div>
        `;

        card.addEventListener("click", () => {
          selectedChoices.clear();
          selectedChoices.add(choice.label);
          persistSelectedChoices();
          updateSelectionUI();
        });
      }

      choicesList.appendChild(card);
    });
    updateSelectionUI();
    if (typeof Prism !== "undefined") {
      Prism.highlightAllUnder(choicesList);
    }
  } else {
    container.style.display = "none";
  }
}

function updateSelectionUI() {
  if (!currentChoiceConfig) {
    return;
  }

  document.querySelectorAll(".choice-card").forEach((card) => {
    const title = card.querySelector(".choice-title")?.textContent;
    const isSelected = Boolean(title && selectedChoices.has(title));
    card.classList.toggle("selected", isSelected);

    const checkbox = card.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.checked = isSelected;
    }
  });
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
    if (currentQuestionId) {
      if (answerText) {
        answerTextByQuestionId.set(currentQuestionId, answerText);
      } else {
        answerTextByQuestionId.delete(currentQuestionId);
      }
    }
    vscode.postMessage({
      type: "updateAnswerText",
      questionId: currentQuestionId,
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
